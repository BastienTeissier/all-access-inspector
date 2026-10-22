<?php

declare(strict_types=1);

namespace AccessInspector\Tests;

use AccessInspector\Axis;
use AccessInspector\Endpoint;
use AccessInspector\Inventory;
use PHPUnit\Framework\TestCase;

final class CheckDiffTest extends TestCase
{
    public function testIgnoresOrderingAndWhitespace(): void
    {
        self::assertSame([], Inventory::check(Samples::load('canonical.input.json'), Samples::load('canonical.json')));
    }

    public function testThreeWayDiff(): void
    {
        $committed = Samples::load('canonical.json');
        [$gone, $kept] = $committed->endpoints;
        $a = $kept->authentication;
        $changed = new Endpoint($kept->method, $kept->path, $kept->handler, new Axis('optional', $a->layer, $a->raw, $a->rule, $a->evidence), $kept->authorization, $kept->dimensions, $kept->unknownReason, $kept->acknowledged);
        $unknown = new Axis('unknown', null, null, null, null);
        $added = new Endpoint($gone->method, '/hooks/', $gone->handler, $unknown, $unknown, $gone->dimensions, 'custom hook', false);
        $diff = Inventory::check($committed, $committed->withEndpoints([$changed, $added, ...array_slice($committed->endpoints, 2)]));
        self::assertEqualsCanonicalizing([
            '- ' . Samples::label($gone),
            '+ ' . Samples::label($added) . ' authentication=unknown authorization=unknown [unknown]',
            '~ ' . Samples::label($kept) . ' authentication.value: ' . $a->value . ' -> optional',
        ], $diff);
    }

    public function testHeaderChange(): void
    {
        $c = Samples::load('canonical.json');
        $current = new Inventory($c->schemaVersion, $c->stack, $c->discoveryMode, $c->coverage, $c->coverageNote, $c->baseStack, $c->baseVersion, $c->bootEnvironment, ['access_tier' => ['public']], [], []);
        $committed = new Inventory($c->schemaVersion, $c->stack, $c->discoveryMode, $c->coverage, $c->coverageNote, $c->baseStack, $c->baseVersion, $c->bootEnvironment, $c->projectDimensions, [], []);
        self::assertSame(
            ['~ project_dimensions: {"access_tier": ["public", "customer", "staff"]} -> {"access_tier": ["public"]}'],
            Inventory::check($committed, $current),
        );
    }

    public function testNullToText(): void
    {
        $committed = Samples::load('canonical.json');
        $first = $committed->endpoints[0];
        $z = $first->authorization;
        $with = fn (?string $raw) => new Endpoint($first->method, $first->path, $first->handler, $first->authentication, new Axis($z->value, $z->layer, $raw, $z->rule, $z->evidence), $first->dimensions, $first->unknownReason, $first->acknowledged);
        self::assertSame(
            ['~ ' . Samples::label($first) . ' authorization.raw: null -> is_staff (overridden)'],
            Inventory::check($committed->withEndpoints([$with(null)]), $committed->withEndpoints([$with('is_staff (overridden)')])),
        );
    }

    public function testFlagsADuplicatedCommittedEntry(): void
    {
        $current = Samples::load('canonical.json');
        $first = $current->endpoints[0];
        self::assertSame(
            ['- ' . Samples::label($first) . ' (duplicate entry)'],
            Inventory::check($current->withEndpoints([$first, ...$current->endpoints]), $current),
        );
    }

    public function testAMalformedCommittedInventoryThrowsBeforeAnyDiff(): void
    {
        try {
            Inventory::fromJson('{"schema_version": "1"}');
            self::fail('a missing key is refused');
        } catch (\InvalidArgumentException $e) {
            self::assertSame('missing key boot_environment', $e->getMessage());
        }
        $this->expectExceptionMessage('invalid JSON');
        Inventory::fromJson("<<<<<<< HEAD\n");
    }
}
