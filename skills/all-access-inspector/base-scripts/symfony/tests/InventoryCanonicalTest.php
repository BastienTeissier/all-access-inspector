<?php

declare(strict_types=1);

namespace AccessInspector\Tests;

use AccessInspector\Axis;
use AccessInspector\Endpoint;
use AccessInspector\Expected;
use AccessInspector\Inventory;
use AccessInspector\ValidationError;
use PHPUnit\Framework\TestCase;

final class InventoryCanonicalTest extends TestCase
{
    public function testCanonicalBytes(): void
    {
        self::assertSame(Samples::text('canonical.json'), Inventory::toCanonicalJson(Samples::load('canonical.input.json')));
    }

    public function testCanonicalBytesEmpty(): void
    {
        self::assertSame(Samples::text('canonical-empty.json'), Inventory::toCanonicalJson(Samples::load('canonical-empty.json')));
    }

    public function testSortsByPathThenMethodThenHandlerByCodePoint(): void
    {
        $shuffled = [
            Samples::endpoint('GET', '/a/b'),
            Samples::endpoint('POST', '/a', 'Z::create'),
            Samples::endpoint('DELETE', '/a'),
            Samples::endpoint('POST', '/a', 'A::create'),
            Samples::endpoint('ANY', '/a'),
            Samples::endpoint('GET', '/😀'),
            Samples::endpoint('GET', '/～'),
        ];
        $lines = explode("\n", Inventory::toCanonicalJson(Samples::load('canonical.input.json')->withEndpoints($shuffled)));
        $start = array_search('  "endpoints": [', $lines, true) + 1;
        $rows = array_map(
            fn ($l) => preg_replace('/.*"method": "(\w+)", "path": "([^"]*)", "handler": "([^"]*)".*/u', '$1 $2 $3', $l),
            array_slice($lines, $start, count($lines) - 3 - $start),
        );
        self::assertSame([
            'ANY /a src/Controller/ShopController.php:12',
            'DELETE /a src/Controller/ShopController.php:12',
            'POST /a A::create',
            'POST /a Z::create',
            'GET /a/b src/Controller/ShopController.php:12',
            'GET /～ src/Controller/ShopController.php:12',
            'GET /😀 src/Controller/ShopController.php:12',
        ], $rows);
    }

    public function testAcceptsTheCanonicalSample(): void
    {
        Inventory::validate(Samples::load('canonical.input.json'));
        $this->addToAssertionCount(1);
    }

    private static function invalid(Endpoint $endpoint, string $message): void
    {
        try {
            Inventory::validate(Samples::load('canonical.input.json')->withEndpoints([$endpoint]));
            self::fail('expected a ValidationError containing ' . $message);
        } catch (ValidationError $e) {
            self::assertStringContainsString($message, $e->getMessage());
        }
    }

    private static function with(Axis $authentication, ?string $reason = null, bool $acknowledged = false): Endpoint
    {
        $e = Samples::endpoint('GET', '/orders/');

        return new Endpoint($e->method, $e->path, $e->handler, $authentication, $e->authorization, $e->dimensions, $reason, $acknowledged);
    }

    public function testRejectsInvalidEndpoints(): void
    {
        $e = Samples::endpoint('GET', '/orders/');
        self::invalid(Samples::endpoint('TRACE', '/orders/'), 'method "TRACE"');
        self::invalid(Samples::endpoint('GET', 'orders/'), 'path must start with /');
        self::invalid(self::with(new Axis('sso', null, null, 'builtin:x', null)), 'outside the Core Classification');
        self::invalid(self::with(new Axis('anonymous', 'view', null, 'builtin:x', null)), 'layer "view"');
        self::invalid(self::with(new Axis('unknown', null, null, 'builtin:x', null)), 'unknown value has no rule');
        self::invalid(self::with(new Axis('required', null, null, 'recognition:x', null)), 'evidence is set exactly');
        self::invalid(self::with(new Axis('anonymous', null, null, 'builtin:no_firewall', 'a.php:1')), 'evidence is set exactly');
        self::invalid(self::with($e->authentication, 'custom'), 'unknown_reason must');
        self::invalid(self::with($e->authentication, null, true), 'acknowledged endpoint carries');
        self::invalid($e->withDimensions(['access_tier' => 'partner']), 'access_tier="partner" is not declared');
        self::invalid($e->withDimensions(['access_tier' => 'public', 'team' => 'sales']), 'GET /orders/ (src/Controller/ShopController.php:12): dimensions');
    }

    public function testRejectsADuplicate(): void
    {
        $twice = [Samples::endpoint('GET', '/orders/'), Samples::endpoint('GET', '/orders/')];
        $this->expectExceptionMessage('duplicate endpoint GET /orders/ (src/Controller/ShopController.php:12)');
        Inventory::validate(Samples::load('canonical.input.json')->withEndpoints($twice));
    }

    public function testBestEffortNeedsANote(): void
    {
        $i = Samples::load('canonical.input.json');
        $bestEffort = new Inventory($i->schemaVersion, $i->stack, $i->discoveryMode, 'best-effort', null, $i->baseStack, $i->baseVersion, $i->bootEnvironment, $i->projectDimensions, $i->expectedAccess, $i->endpoints);
        $this->expectExceptionMessage('requires a coverage_note');
        Inventory::validate($bestEffort);
    }

    public function testExpectedAccessNamesDeclaredValues(): void
    {
        $i = Samples::load('canonical.input.json');
        $wrong = new Inventory($i->schemaVersion, $i->stack, $i->discoveryMode, $i->coverage, $i->coverageNote, $i->baseStack, $i->baseVersion, $i->bootEnvironment, $i->projectDimensions, ['access_tier' => ['partner' => new Expected(['required'], ['none'])]], $i->endpoints);
        $this->expectExceptionMessage('access_tier="partner" is not a declared');
        Inventory::validate($wrong);
    }
}
