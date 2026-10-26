<?php

declare(strict_types=1);

namespace AccessInspector;

/** JSON as the inventory needs it: objects keep their key order, lists stay lists. */
final class Json
{
    /**
     * JSON with ", " and ": " separators; non-ASCII and / unescaped, as Python's json.dumps(ensure_ascii=False).
     * An object is a stdClass or a non-list array; an empty array is a list.
     */
    public static function compact(mixed $value): string
    {
        if ($value === null) {
            return 'null';
        }
        if (is_string($value)) {
            return self::quote($value);
        }
        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }
        if (is_int($value) || is_float($value)) {
            return json_encode($value, JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR);
        }
        if ($value instanceof \stdClass) {
            $value = get_object_vars($value);
            if ($value === []) {
                return '{}';
            }
        }
        if (is_array($value)) {
            if (array_is_list($value)) {
                return '[' . implode(', ', array_map(self::compact(...), $value)) . ']';
            }
            $members = [];
            foreach ($value as $key => $item) {
                $members[] = self::quote((string) $key) . ': ' . self::compact($item);
            }

            return '{' . implode(', ', $members) . '}';
        }
        throw new \InvalidArgumentException('not a JSON value: ' . get_debug_type($value));
    }

    public static function quote(string $text): string
    {
        return json_encode($text, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_LINE_TERMINATORS | JSON_THROW_ON_ERROR);
    }

    /** Objects decode as stdClass, so an empty object stays one. */
    public static function parse(string $text): mixed
    {
        try {
            return json_decode($text, false, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new \InvalidArgumentException('invalid JSON: ' . $e->getMessage());
        }
    }
}
