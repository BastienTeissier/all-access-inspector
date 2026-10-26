<?php

declare(strict_types=1);

namespace AccessInspector\Tests;

use AccessInspector\Axis;
use AccessInspector\Endpoint;
use AccessInspector\Inventory;

/** The shared samples every Base Script serialises byte for byte. */
final class Samples
{
    public static function text(string $name): string
    {
        return (string) file_get_contents(dirname(__DIR__, 3) . '/schema/samples/' . $name);
    }

    public static function load(string $name): Inventory
    {
        return Inventory::fromJson(self::text($name));
    }

    public static function endpoint(string $method, string $path, string $handler = 'src/Controller/ShopController.php:12'): Endpoint
    {
        return new Endpoint(
            $method,
            $path,
            $handler,
            new Axis('anonymous', 'framework-default', null, 'builtin:no_firewall', null),
            new Axis('none', 'framework-default', null, 'builtin:no_firewall', null),
            ['access_tier' => 'public'],
            null,
            false,
        );
    }

    public static function label(Endpoint $e): string
    {
        return $e->method . ' ' . $e->path . ' (' . $e->handler . ')';
    }
}
