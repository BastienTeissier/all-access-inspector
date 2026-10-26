<?php

declare(strict_types=1);

namespace AccessInspector;

final class Assign
{
    /** @param \Closure(Endpoint): bool $when */
    public function __construct(public readonly string $dimension, public readonly string $value, public readonly \Closure $when)
    {
    }
}

final class MissingDimension extends \RuntimeException
{
}

/** Project Dimensions: the project's own labels, assigned to every endpoint by ordered rules. */
final class Dimensions
{
    // --- project ---
    /** Declared values, in order, e.g. ['access_tier' => ['public', 'customer', 'staff']]. */
    public const DIMENSIONS = ['access_tier' => ['public', 'user', 'staff']];

    /**
     * What each value should allow, as the team confirmed it; a value left out is not checked, e.g.
     * ['access_tier' => ['staff' => new Expected(['required'], ['rule'])]].
     *
     * @return array<string, array<string, Expected>>
     */
    public static function expected(): array
    {
        return ['access_tier' => ['staff' => new Expected(['required'], ['rule'])]];
    }

    /**
     * Most specific first; the first matching rule of a dimension wins, e.g.:
     * new Assign('access_tier', 'staff', fn (Endpoint $e) => str_starts_with($e->path, '/admin/')),
     *
     * @return list<Assign>
     */
    public static function rules(): array
    {
        $under = fn (string ...$prefixes) => fn (Endpoint $e) => array_filter($prefixes, fn ($p) => str_starts_with($e->path, $p)) !== [];

        return [
            new Assign('access_tier', 'staff', $under('/admin')),
            new Assign('access_tier', 'user', $under('/account', '/api/books', '/posts', '/projects')),
            new Assign('access_tier', 'public', fn (Endpoint $e) => true),
        ];
    }
    // --- end project ---

    /**
     * One value per declared dimension; an endpoint no rule covers is a failure, never a null.
     *
     * @param array<string, list<string>>|null $dimensions
     * @param list<Assign>|null $rules
     * @return array<string, string>
     */
    public static function assign(Endpoint $endpoint, ?array $dimensions = null, ?array $rules = null): array
    {
        $dimensions ??= self::DIMENSIONS;
        $rules ??= self::rules();
        $assigned = [];
        foreach (array_keys($dimensions) as $dimension) {
            $value = null;
            foreach ($rules as $rule) {
                if ($rule->dimension === (string) $dimension && ($rule->when)($endpoint)) {
                    $value = $rule->value;
                    break;
                }
            }
            if ($value === null) {
                throw new MissingDimension(Inventory::label($endpoint) . ": no rule assigns dimension '" . $dimension . "'");
            }
            $assigned[$dimension] = $value;
        }

        return $assigned;
    }
}
