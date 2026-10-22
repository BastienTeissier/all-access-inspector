<?php

declare(strict_types=1);

namespace AccessInspector\Tests;

use AccessInspector\Attributes;
use AccessInspector\Finding;
use AccessInspector\Tests\Fixtures\ShopController;
use PHPUnit\Framework\TestCase;

final class AttributesTest extends TestCase
{
    /** @return list<Finding> */
    private static function findings(string $method, string $http): array
    {
        return Attributes::findings(new \ReflectionClass(ShopController::class), new \ReflectionMethod(ShopController::class, $method), $http, dirname(__DIR__));
    }

    public function testTheClassThenTheMethodAttributeApplyAnIsGrantedForItsMethodsOnly(): void
    {
        self::assertEquals([
            new Finding("#[IsGranted('ROLE_USER')]", 'class', "#[IsGranted('ROLE_USER')]", 'role'),
            new Finding("#[IsGranted('ROLE_EDITOR', methods: ['POST'])]", 'method', "#[IsGranted('ROLE_EDITOR', methods: ['POST'])]", 'role'),
        ], self::findings('edit', 'POST'));
        self::assertCount(1, self::findings('edit', 'GET'));
    }

    public function testAnExpressionIsShownAsWrittenAndReadOnlyWhenItIsOneBuiltinCall(): void
    {
        $owner = self::findings('owner', 'GET')[1];
        self::assertSame("#[IsGranted(new Expression('is_granted(\\'ROLE_ADMIN\\') or user.isOwner()'))]", $owner->construct);
        self::assertNull($owner->builtin);
    }

    public function testABodyCheckIsReadForOneAccessAttributeAndUnknownForAVoter(): void
    {
        [, $manager, $voter] = self::findings('body', 'GET');
        self::assertEquals(new Finding("denyAccessUnlessGranted('ROLE_MANAGER')", 'method', "denyAccessUnlessGranted('ROLE_MANAGER')", 'role'), $manager);
        self::assertEquals(new Finding("denyAccessUnlessGranted('ORDER_EDIT', \$order)", 'method', "denyAccessUnlessGranted('ORDER_EDIT', \$order)", null, Attributes::BODY), $voter);
    }

    public function testAVendorHandlerBodyIsNotRead(): void
    {
        self::assertCount(1, Attributes::findings(new \ReflectionClass(ShopController::class), new \ReflectionMethod(ShopController::class, 'body'), 'GET', '/elsewhere'));
    }
}
