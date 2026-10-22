<?php

declare(strict_types=1);

namespace AccessInspector;

/** Fixed-width terminal table rendered from an inventory; never written to disk. */
final class Table
{
    private const HEADER = ['', 'METHOD', 'PATH', 'AUTHENTICATION', 'AUTHORIZATION', 'HANDLER', 'DIMENSIONS'];

    public static function render(Inventory $inventory): string
    {
        $rows = [self::HEADER];
        foreach (Inventory::sorted($inventory->endpoints) as $e) {
            $dimensions = implode(' ', array_map(fn ($d, $v) => $d . '=' . $v, array_keys($e->dimensions), $e->dimensions));
            $rows[] = [Inventory::isUnknown($e) ? '?' : '', $e->method, $e->path, self::axis($e->authentication), self::axis($e->authorization), $e->handler, $dimensions];
        }
        $widths = array_fill(0, count(self::HEADER), 0);
        foreach ($rows as $row) {
            foreach ($row as $i => $cell) {
                $widths[$i] = max($widths[$i], self::length($cell));
            }
        }

        return implode("\n", array_map(function (array $row) use ($widths) {
            $cells = [];
            foreach ($row as $i => $cell) {
                $cells[] = $cell . str_repeat(' ', $widths[$i] - self::length($cell));
            }

            return rtrim(implode('  ', $cells));
        }, $rows));
    }

    /** Code points, as the other Base Scripts count them. */
    private static function length(string $s): int
    {
        return (int) preg_match_all('/./us', $s);
    }

    private static function axis(Axis $a): string
    {
        return $a->layer !== null ? $a->value . '@' . $a->layer : $a->value;
    }
}
