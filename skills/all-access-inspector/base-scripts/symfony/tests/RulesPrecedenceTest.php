<?php

declare(strict_types=1);

namespace AccessInspector\Tests;

use AccessInspector\Ack;
use AccessInspector\Axis;
use AccessInspector\Finding;
use AccessInspector\Resolved;
use AccessInspector\Rule;
use AccessInspector\RuleError;
use AccessInspector\Rules;
use PHPUnit\Framework\TestCase;

final class RulesPrecedenceTest extends TestCase
{
    private const EVIDENCE = 'tests/RulesPrecedenceTest.php:1';

    private static function firewall(): Finding
    {
        return new Finding('IS_AUTHENTICATED_FULLY', 'global', 'main: ^/ -> IS_AUTHENTICATED_FULLY', 'IS_AUTHENTICATED_FULLY');
    }

    private static function admin(): Finding
    {
        return new Finding("#[IsGranted('ROLE_ADMIN')]", 'method', "#[IsGranted('ROLE_ADMIN')]", 'role');
    }

    private static function open(): Finding
    {
        return new Finding('PUBLIC_ACCESS', 'global', 'main: ^/open -> PUBLIC_ACCESS', 'PUBLIC_ACCESS');
    }

    private static function custom(): Finding
    {
        return new Finding("#[IsGranted('CAR_READ', subject: 'car')]", 'method', "#[IsGranted('CAR_READ', subject: 'car')]", null);
    }

    /** @param list<Finding> $findings @param list<Rule> $rules @param list<Ack> $acks */
    private static function resolve(array $findings, string $method, array $rules = [], array $acks = []): Resolved
    {
        return Rules::resolveAccess($findings, $method, '/cars/{id}', $rules, $acks);
    }

    public function testTheStrictestCheckWinsPerAxis(): void
    {
        $r = self::resolve([self::open(), self::admin()], 'GET');
        self::assertSame('required', $r->authentication->value);
        self::assertSame('method', $r->authentication->layer);
        self::assertSame('builtin:role', $r->authorization->rule);
    }

    public function testOnATieTheCheckARequestMeetsFirstIsReported(): void
    {
        $r = self::resolve([self::firewall(), new Finding("#[IsGranted('IS_AUTHENTICATED')]", 'class', "#[IsGranted('IS_AUTHENTICATED')]", 'IS_AUTHENTICATED')], 'GET');
        self::assertSame('global', $r->authentication->layer);
        self::assertSame('none', $r->authorization->value);
    }

    public function testAnUnreadCheckIsUnknownAndOutranksARule(): void
    {
        $r = self::resolve([self::firewall(), self::custom()], 'GET');
        self::assertEquals(new Axis('unknown', 'method', self::custom()->raw, null, null), $r->authorization);
        self::assertSame('required', $r->authentication->value);
        self::assertNull($r->reason);
    }

    public function testARecognitionRuleReadsTheConstructItNames(): void
    {
        $rule = Rule::construct('car_read', self::EVIDENCE, self::custom()->construct, 'required', 'rule');
        $r = self::resolve([self::firewall(), self::custom()], 'GET', [$rule]);
        self::assertEquals(new Axis('rule', 'method', self::custom()->raw, 'recognition:car_read', self::EVIDENCE), $r->authorization);
    }

    public function testARecognitionRuleOverridesABuiltin(): void
    {
        $rule = Rule::construct('open_is_tenant', self::EVIDENCE, 'PUBLIC_ACCESS', 'required', 'none')->withRaw('tenant header');
        $r = self::resolve([self::open()], 'POST', [$rule]);
        self::assertEquals(new Axis('required', 'global', 'tenant header', 'recognition:open_is_tenant', self::EVIDENCE), $r->authentication);
    }

    public function testAPathPrefixRuleAddsACheckAtItsLayerAndSafeMethodsTakeTheSafeValue(): void
    {
        $rule = Rule::pathPrefix('partner', self::EVIDENCE, '/cars/', 'global', 'required', 'rule')->safe('optional', 'none');
        self::assertSame('recognition:partner', self::resolve([self::open()], 'POST', [$rule])->authorization->rule);
        $get = self::resolve([self::open()], 'GET', [$rule]);
        self::assertSame('optional', $get->authentication->value);
        self::assertSame('none', $get->authorization->value);
        self::assertSame('recognition:partner', $get->authorization->rule);
    }

    public function testAnAcknowledgedUnknownGivesItsReason(): void
    {
        $byConstruct = self::resolve([self::firewall(), self::custom()], 'GET', [], [Ack::construct('ownership is checked by the voter', self::custom()->construct)]);
        self::assertSame('ownership is checked by the voter', $byConstruct->reason);
        self::assertTrue($byConstruct->acknowledged);
        self::assertTrue(self::resolve([self::firewall(), self::custom()], 'GET', [], [Ack::path('out of scope', '/cars/{id}')])->acknowledged);
        self::assertNull(self::resolve([self::firewall(), self::admin()], 'GET', [], [Ack::path('out of scope', '/cars/{id}')])->reason);
    }

    public function testACheckTheScriptCannotReadCarriesItsReason(): void
    {
        $broken = new Finding('symfony-security', 'global', 'main: access_control', null, 'Symfony Security internals changed: x');
        $r = self::resolve([$broken, self::admin()], 'GET');
        self::assertSame('required', $r->authentication->value);
        self::assertSame('unknown', $r->authorization->value);
        self::assertSame('Symfony Security internals changed: x', $r->reason);
    }

    public function testAnAnyEndpointIsSplitOnlyWhenItsMethodsDiffer(): void
    {
        self::assertSame(['ANY'], Rules::methods(fn ($m) => [self::firewall()], 'ANY', '/x', []));
        self::assertSame(
            ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
            Rules::methods(fn ($m) => [$m === 'GET' ? self::open() : self::firewall()], 'ANY', '/x', []),
        );
        self::assertSame(['GET'], Rules::methods(fn ($m) => [self::firewall()], 'GET', '/x', []));
    }

    public function testAMalformedRuleOrEvidenceOutsideTheProjectIsRefused(): void
    {
        $root = dirname(__DIR__);
        Rules::checkRules([Rule::construct('ok', self::EVIDENCE, 'x', 'required', 'none')], $root);
        $refused = function (Rule $rule, string $message) use ($root) {
            try {
                Rules::checkRules([$rule], $root);
                self::fail('expected ' . $message);
            } catch (RuleError $e) {
                self::assertSame($message, $e->getMessage());
            }
        };
        $refused(new Rule('both', self::EVIDENCE, 'x', '/a', 'global', 'required', 'none'), 'rule both: set exactly one of construct or pathPrefix');
        $refused(new Rule('p', self::EVIDENCE, null, '/a', null, 'required', 'none'), 'rule p: a pathPrefix rule needs a layer');
        $refused(Rule::construct('v', self::EVIDENCE, 'x', 'sso', 'none'), "rule v: 'sso' is not one of required, unknown, optional, anonymous");
        $refused(Rule::construct('e', 'src/Missing.php:3', 'x', 'required', 'none'), 'rule e: evidence src/Missing.php:3 does not exist');
        $refused(Rule::construct('e', 'composer.json:100000', 'x', 'required', 'none'), 'rule e: evidence composer.json:100000 is past the end of the file');
        $refused(Rule::construct('e', '../../VERSION:1', 'x', 'required', 'none'), 'rule e: evidence ../../VERSION:1 does not exist');
    }

    public function testAnAccessAttributeReadsAsItsBuiltinAndAVoterAttributeAsNone(): void
    {
        self::assertSame('role', Rules::attribute('ROLE_ADMIN'));
        self::assertSame('PUBLIC_ACCESS', Rules::attribute('PUBLIC_ACCESS'));
        self::assertSame('IS_AUTHENTICATED_FULLY', Rules::attribute('IS_AUTHENTICATED_FULLY'));
        self::assertNull(Rules::attribute('POST_EDIT'));
    }

    public function testAnyAccessControlAttributeGrantsSoTheWeakestDecides(): void
    {
        self::assertSame('no_roles', Rules::attributes([]));
        self::assertSame('role', Rules::attributes(['ROLE_ADMIN', 'ROLE_EDITOR']));
        self::assertSame('IS_AUTHENTICATED', Rules::attributes(['ROLE_ADMIN', 'IS_AUTHENTICATED']));
        self::assertSame('PUBLIC_ACCESS', Rules::attributes(['IS_AUTHENTICATED_FULLY', 'PUBLIC_ACCESS']));
        self::assertNull(Rules::attributes(['ROLE_ADMIN', 'POST_EDIT']));
    }

    public function testOnlyABuiltinCallWithALiteralIsABuiltinExpression(): void
    {
        self::assertSame('role', Rules::expression("is_granted('ROLE_USER')"));
        self::assertSame('role', Rules::expression(' is_granted("ROLE_USER") '));
        self::assertSame('is_authenticated', Rules::expression('is_authenticated()'));
        self::assertSame('PUBLIC_ACCESS', Rules::expression("is_granted('PUBLIC_ACCESS')"));
        self::assertNull(Rules::expression("is_granted('BOOK_EDIT', object)"));
        self::assertNull(Rules::expression("is_granted('ROLE_ADMIN') or object.owner == user"));
        self::assertNull(Rules::expression("is_granted('POST_EDIT')"));
    }
}
