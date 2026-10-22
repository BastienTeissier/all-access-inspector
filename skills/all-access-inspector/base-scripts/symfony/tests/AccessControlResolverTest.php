<?php

declare(strict_types=1);

namespace AccessInspector\Tests;

use AccessInspector\AccessControlResolver;
use AccessInspector\Finding;
use AccessInspector\InspectorKernel;
use AccessInspector\Rules;
use PHPUnit\Framework\TestCase;
use Symfony\Bundle\SecurityBundle\Security\FirewallConfig;
use Symfony\Component\DependencyInjection\Container;
use Symfony\Component\ExpressionLanguage\Expression;
use Symfony\Component\HttpFoundation\ChainRequestMatcher;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestMatcher\IpsRequestMatcher;
use Symfony\Component\HttpFoundation\RequestMatcher\MethodRequestMatcher;
use Symfony\Component\HttpFoundation\RequestMatcher\PathRequestMatcher;
use Symfony\Component\HttpFoundation\RequestMatcherInterface;
use Symfony\Component\Security\Http\AccessMap;

final class AccessControlResolverTest extends TestCase
{
    /** @param array<string, bool> $firewalls name => security enabled, by path prefix */
    private static function resolver(?object $accessMap, array $firewalls = ['/' => true]): AccessControlResolver
    {
        $container = new Container();
        $container->set(InspectorKernel::FIREWALL_MAP, new class($firewalls) {
            public function __construct(private array $firewalls)
            {
            }

            public function getFirewallConfig(Request $request): ?FirewallConfig
            {
                foreach ($this->firewalls as $prefix => $enabled) {
                    if (str_starts_with($request->getPathInfo(), $prefix)) {
                        return new FirewallConfig($enabled ? 'main' : 'dev', 'user_checker', null, $enabled);
                    }
                }

                return null;
            }
        });
        if ($accessMap !== null) {
            $container->set(InspectorKernel::ACCESS_MAP, $accessMap);
        }

        return new AccessControlResolver($container);
    }

    private static function map(): AccessMap
    {
        $map = new AccessMap();
        $map->add(new ChainRequestMatcher([new PathRequestMatcher('^/open')]), ['PUBLIC_ACCESS']);
        $map->add(new ChainRequestMatcher([new PathRequestMatcher('^/cars'), new MethodRequestMatcher(['POST'])]), ['ROLE_USER', 'ROLE_ADMIN']);
        $map->add(new ChainRequestMatcher([new PathRequestMatcher('^/net'), new IpsRequestMatcher(['10.0.0.0/8'])]), ['PUBLIC_ACCESS']);
        $map->add(new ChainRequestMatcher([new PathRequestMatcher('^/owner')]), [new Expression("is_granted('ROLE_ADMIN') or user.isOwner()")]);
        $map->add(new ChainRequestMatcher([new PathRequestMatcher('^/account')]), [new Expression('is_authenticated()')]);
        $map->add(new class implements RequestMatcherInterface {
            public function matches(Request $request): bool
            {
                return $request->headers->has('X-Partner');
            }
        }, ['ROLE_PARTNER']);

        return $map;
    }

    public function testEachEntryKindReadsAsItsBuiltin(): void
    {
        $resolver = self::resolver(self::map());
        self::assertEquals(new Finding('PUBLIC_ACCESS', 'global', 'main: ^/open -> PUBLIC_ACCESS', 'PUBLIC_ACCESS'), $resolver->resolve('GET', '/open/x'));
        self::assertEquals(new Finding('ROLE_USER, ROLE_ADMIN', 'global', 'main: ^/cars [POST] -> ROLE_USER, ROLE_ADMIN', 'role'), $resolver->resolve('POST', '/cars'));
        self::assertSame('allow_if: is_authenticated()', $resolver->resolve('GET', '/account')->construct);
        self::assertSame('is_authenticated', $resolver->resolve('GET', '/account')->builtin);
        self::assertNull($resolver->resolve('GET', '/owner')->builtin);
    }

    public function testAnEntryWithAConditionTheScriptCannotEvaluateIsUnknownWithItsReason(): void
    {
        $finding = self::resolver(self::map())->resolve('GET', '/net');
        self::assertSame('^/net ips=10.0.0.0/8 -> PUBLIC_ACCESS', $finding->construct);
        self::assertSame('access_control entry 3 applies only when ips=10.0.0.0/8 match; other requests go on to the next entry', $finding->reason);
    }

    public function testACustomMatcherIsUnknownWhetherOrNotTheSampleRequestMatches(): void
    {
        $finding = self::resolver(self::map())->resolve('GET', '/cars');
        self::assertNull($finding->builtin);
        self::assertStringStartsWith('access_control entry 6 uses ', $finding->reason);
        self::assertStringEndsWith('; the script cannot tell which requests it matches', $finding->reason);
    }

    public function testNoEntryNoFirewallOrNoSecurityLetEveryRequestThrough(): void
    {
        self::assertSame('no_access_control', self::resolver(new AccessMap())->resolve('GET', '/x')->builtin);
        self::assertSame('no_firewall', self::resolver(new AccessMap(), ['/api' => true])->resolve('GET', '/x')->builtin);
        self::assertEquals(new Finding('security: false', 'global', 'dev: security: false', 'security_false'), self::resolver(new AccessMap(), ['/' => false])->resolve('GET', '/x'));
        self::assertSame('no_security', (new AccessControlResolver(new Container()))->resolve('GET', '/x')->builtin);
    }

    public function testMovedInternalsReadAsUnknownWithTheirReasonNeverACrash(): void
    {
        $finding = self::resolver(new \stdClass())->resolve('GET', '/open/x');
        self::assertNull($finding->builtin);
        self::assertSame('global', $finding->layer);
        self::assertStringStartsWith(AccessControlResolver::INTERNALS_CHANGED . ': ReflectionException: ', $finding->reason);
        $resolved = Rules::resolveAccess([$finding], 'GET', '/open/x', [], []);
        self::assertSame('unknown', $resolved->authentication->value);
        self::assertStringStartsWith('Symfony Security internals changed', $resolved->reason);
    }
}
