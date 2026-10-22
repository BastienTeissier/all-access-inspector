<?php

declare(strict_types=1);

namespace AccessInspector\Tests;

use AccessInspector\Discovery;
use AccessInspector\Mapped;
use AccessInspector\Tests\Fixtures\ShopController;
use PHPUnit\Framework\TestCase;
use Symfony\Component\DependencyInjection\Container;
use Symfony\Component\Routing\Route;
use Symfony\Component\Routing\RouteCollection;

final class DiscoveryTest extends TestCase
{
    /** @param array<string, Route> $routes @return list<string> */
    private static function discover(array $routes, string $root = '/elsewhere'): array
    {
        $collection = new RouteCollection();
        foreach ($routes as $name => $route) {
            $collection->add($name, $route);
        }
        $container = new Container();
        $container->set('router', new class($collection) {
            public function __construct(private RouteCollection $routes)
            {
            }

            public function getRouteCollection(): RouteCollection
            {
                return $this->routes;
            }
        });

        return array_map(fn (Mapped $m) => $m->method . ' ' . $m->path . ' ' . $m->handler, Discovery::discover($container, $root));
    }

    public function testTheFirstRouteOfAMethodAndPathAnswersAndHeadGoesWithGet(): void
    {
        $edit = ShopController::class . '::edit';
        $owner = ShopController::class . '::owner';
        self::assertSame([
            "GET /shop $edit",
            "HEAD /shop $edit",
            "POST /shop $owner",
            "DELETE /shop $owner",
            "OPTIONS /shop $owner",
            "PATCH /shop $owner",
            "PUT /shop $owner",
        ], self::discover([
            'a' => new Route('/shop', ['_controller' => $edit], methods: ['GET']),
            'b' => new Route('/shop', ['_controller' => $owner], methods: ['GET', 'POST']),
            'c' => new Route('/shop', ['_controller' => $owner]),
        ]));
    }

    public function testAProjectHandlerIsItsFileAndLineAndAnUnresolvedControllerItsName(): void
    {
        self::assertSame(['ANY /shop/{id} tests/Fixtures/ShopController.php:14'], self::discover(['a' => new Route('/shop/{!id}', ['_controller' => ShopController::class . '::edit'])], dirname(__DIR__)));
        self::assertSame(['ANY /x app.missing::run'], self::discover(['a' => new Route('/x', ['_controller' => 'app.missing::run'])]));
    }

    public function testASampleIsAPathTheRouteMatchesOrNoneWhenNoValueSatisfiesItsRequirements(): void
    {
        self::assertSame('/api/books/1', Discovery::sample(new Route('/api/books/{id}.{_format}', ['_format' => null])));
        self::assertSame('/en/admin', Discovery::sample(new Route('/{_locale}/admin', [], ['_locale' => 'en|fr'])));
        self::assertSame('/fr/admin', Discovery::sample(new Route('/{_locale}/admin', ['_locale' => 'fr'], ['_locale' => 'en|fr'])));
        self::assertSame('/shop/a/1', Discovery::sample(new Route('/shop/{slug}/{id}', [], ['slug' => '[a-z-]+'])));
        self::assertNull(Discovery::sample(new Route('/x/{id}', [], ['id' => '\\d{3}'])));
    }
}
