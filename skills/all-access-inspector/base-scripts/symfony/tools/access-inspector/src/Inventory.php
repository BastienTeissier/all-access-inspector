<?php

declare(strict_types=1);

namespace AccessInspector;

/** value, layer, raw, rule; evidence is the Recognition Rule's file:line, null otherwise. */
final class Axis
{
    public function __construct(
        public readonly ?string $value,
        public readonly ?string $layer,
        public readonly ?string $raw,
        public readonly ?string $rule,
        public readonly ?string $evidence,
    ) {
    }
}

/** acknowledged: the unknown_reason is an Acknowledged Unknown's. */
final class Endpoint
{
    /** @param array<string, string> $dimensions */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly string $handler,
        public readonly Axis $authentication,
        public readonly Axis $authorization,
        public readonly array $dimensions,
        public readonly ?string $unknownReason,
        public readonly bool $acknowledged,
    ) {
    }

    /** @param array<string, string> $dimensions */
    public function withDimensions(array $dimensions): self
    {
        return new self($this->method, $this->path, $this->handler, $this->authentication, $this->authorization, $dimensions, $this->unknownReason, $this->acknowledged);
    }
}

final class Env
{
    public function __construct(public readonly string $name, public readonly string $value, public readonly string $reason)
    {
    }
}

/** What a dimension value should allow, as the team confirmed it. */
final class Expected
{
    /** @param list<string>|null $authentication @param list<string>|null $authorization */
    public function __construct(public readonly ?array $authentication, public readonly ?array $authorization)
    {
    }
}

/**
 * stubs and pinned are kept as read, as ordered {target, reason} and {setting, value, reason}; this Base Script
 * never stubs a service nor pins a setting.
 */
final class BootEnvironment
{
    /** @param list<Env> $environ @param list<array<string, mixed>> $stubs @param list<array<string, mixed>> $pinned */
    public function __construct(public readonly ?string $entry, public readonly array $environ, public readonly array $stubs, public readonly array $pinned)
    {
    }
}

final class ValidationError extends \RuntimeException
{
}

/** Endpoint Inventory model, canonical serialisation and the checks JSON Schema cannot express. */
final class Inventory
{
    public const SCHEMA_VERSION = '1';
    public const METHODS = ['ANY', 'DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'];
    public const AUTHENTICATION = ['anonymous', 'optional', 'required', 'unknown'];
    public const AUTHORIZATION = ['none', 'rule', 'unknown'];
    public const LAYERS = ['global', 'class', 'method', 'framework-default', null];
    public const EXPECTED_AXES = ['authentication' => ['anonymous', 'optional', 'required'], 'authorization' => ['none', 'rule']];

    /**
     * @param array<string, list<string>> $projectDimensions
     * @param array<string, array<string, Expected>> $expectedAccess
     * @param list<Endpoint> $endpoints
     */
    public function __construct(
        public readonly ?string $schemaVersion,
        public readonly ?string $stack,
        public readonly ?string $discoveryMode,
        public readonly ?string $coverage,
        public readonly ?string $coverageNote,
        public readonly ?string $baseStack,
        public readonly ?string $baseVersion,
        public readonly BootEnvironment $bootEnvironment,
        public readonly array $projectDimensions,
        public readonly array $expectedAccess,
        public readonly array $endpoints,
    ) {
    }

    /** @param list<Endpoint> $endpoints */
    public function withEndpoints(array $endpoints): self
    {
        return new self($this->schemaVersion, $this->stack, $this->discoveryMode, $this->coverage, $this->coverageNote, $this->baseStack, $this->baseVersion, $this->bootEnvironment, $this->projectDimensions, $this->expectedAccess, $endpoints);
    }

    public static function isUnknown(Endpoint $e): bool
    {
        return $e->authentication->value === 'unknown' || $e->authorization->value === 'unknown';
    }

    public static function label(Endpoint $e): string
    {
        return $e->method . ' ' . $e->path . ' (' . $e->handler . ')';
    }

    /** Path, then method, then handler; strcmp on UTF-8 is code point order, as Python sorts strings. */
    public static function order(Endpoint $a, Endpoint $b): int
    {
        return strcmp($a->path, $b->path) ?: strcmp($a->method, $b->method) ?: strcmp($a->handler, $b->handler);
    }

    /**
     * @param list<Endpoint> $endpoints
     * @return list<Endpoint>
     */
    public static function sorted(array $endpoints): array
    {
        usort($endpoints, self::order(...));

        return $endpoints;
    }

    private static function identity(Endpoint $e): string
    {
        return $e->path . "\0" . $e->method . "\0" . $e->handler;
    }

    /** An empty map stays a JSON object. */
    private static function object(array $map): array|\stdClass
    {
        return $map === [] ? new \stdClass() : $map;
    }

    // --- canonical form ---

    /** @return array<string, ?string> */
    private static function axisTree(Axis $a): array
    {
        return ['value' => $a->value, 'layer' => $a->layer, 'raw' => $a->raw, 'rule' => $a->rule, 'evidence' => $a->evidence];
    }

    /**
     * The endpoint's keys in schema order; dimensions in declaration order, any undeclared one after.
     *
     * @param list<string> $declared
     * @return array<string, mixed>
     */
    public static function endpointTree(Endpoint $e, array $declared): array
    {
        $dimensions = [];
        foreach ($declared as $d) {
            if (array_key_exists($d, $e->dimensions)) {
                $dimensions[$d] = $e->dimensions[$d];
            }
        }
        $dimensions += $e->dimensions;

        return [
            'method' => $e->method,
            'path' => $e->path,
            'handler' => $e->handler,
            'authentication' => self::axisTree($e->authentication),
            'authorization' => self::axisTree($e->authorization),
            'dimensions' => self::object($dimensions),
            'unknown_reason' => $e->unknownReason,
            'acknowledged' => $e->acknowledged,
        ];
    }

    /**
     * Every object with its keys in schema order, whatever order the source had.
     *
     * @return array<string, mixed>
     */
    public static function tree(self $inventory): array
    {
        $boot = $inventory->bootEnvironment;
        $expected = [];
        foreach ($inventory->expectedAccess as $dimension => $values) {
            $byValue = [];
            foreach ($values as $value => $access) {
                $byValue[$value] = ['authentication' => $access->authentication, 'authorization' => $access->authorization];
            }
            $expected[$dimension] = self::object($byValue);
        }
        $declared = array_map('strval', array_keys($inventory->projectDimensions));

        return [
            'schema_version' => $inventory->schemaVersion,
            'stack' => $inventory->stack,
            'discovery_mode' => $inventory->discoveryMode,
            'coverage' => $inventory->coverage,
            'coverage_note' => $inventory->coverageNote,
            'base_script' => ['stack' => $inventory->baseStack, 'version' => $inventory->baseVersion],
            'boot_environment' => [
                'entry' => $boot->entry,
                'environ' => array_map(fn (Env $e) => ['name' => $e->name, 'value' => $e->value, 'reason' => $e->reason], $boot->environ),
                'stubs' => array_map(fn (array $s) => ['target' => $s['target'], 'reason' => $s['reason']], $boot->stubs),
                'pinned' => array_map(fn (array $p) => ['setting' => $p['setting'], 'value' => $p['value'], 'reason' => $p['reason']], $boot->pinned),
            ],
            'project_dimensions' => self::object($inventory->projectDimensions),
            'expected_access' => self::object($expected),
            'endpoints' => array_map(fn (Endpoint $e) => self::endpointTree($e, $declared), $inventory->endpoints),
        ];
    }

    public static function compact(Endpoint $e, self $inventory): string
    {
        return Json::compact(self::endpointTree($e, array_map('strval', array_keys($inventory->projectDimensions))));
    }

    /** Serialise per plan §2; the reference bytes are schema/samples/canonical.json. */
    public static function toCanonicalJson(self $inventory): string
    {
        $header = self::tree($inventory);
        unset($header['endpoints']);
        $lines = ['{'];
        foreach ($header as $key => $value) {
            $lines[] = '  ' . Json::quote($key) . ': ' . Json::compact($value) . ',';
        }
        $declared = array_map('strval', array_keys($inventory->projectDimensions));
        $endpoints = array_map(fn (Endpoint $e) => '    ' . Json::compact(self::endpointTree($e, $declared)), self::sorted($inventory->endpoints));
        if ($endpoints === []) {
            $lines[] = '  "endpoints": []';
        } else {
            $lines[] = '  "endpoints": [';
            $lines[] = implode(",\n", $endpoints);
            $lines[] = '  ]';
        }
        $lines[] = '}';

        return implode("\n", $lines) . "\n";
    }

    // --- reading ---

    private static function get(mixed $map, string $key): mixed
    {
        if (!$map instanceof \stdClass) {
            throw new \InvalidArgumentException('expected an object holding ' . $key);
        }
        if (!property_exists($map, $key)) {
            throw new \InvalidArgumentException('missing key ' . $key);
        }

        return $map->{$key};
    }

    private static function text(mixed $map, string $key): ?string
    {
        $value = self::get($map, $key);
        if ($value !== null && !is_string($value)) {
            throw new \InvalidArgumentException($key . ' must be a string or null');
        }

        return $value;
    }

    /** @return list<mixed> */
    private static function list(mixed $map, string $key): array
    {
        $value = self::get($map, $key);
        if (!is_array($value)) {
            throw new \InvalidArgumentException($key . ' must be a list');
        }

        return $value;
    }

    /** @return array<string, mixed> */
    private static function members(mixed $map, string $key): array
    {
        $value = self::get($map, $key);
        if (!$value instanceof \stdClass) {
            throw new \InvalidArgumentException($key . ' must be an object');
        }

        return get_object_vars($value);
    }

    private static function axis(mixed $a): Axis
    {
        return new Axis(self::text($a, 'value'), self::text($a, 'layer'), self::text($a, 'raw'), self::text($a, 'rule'), self::text($a, 'evidence'));
    }

    private static function endpoint(mixed $e): Endpoint
    {
        $acknowledged = self::get($e, 'acknowledged');
        if (!is_bool($acknowledged)) {
            throw new \InvalidArgumentException('acknowledged must be a boolean');
        }

        return new Endpoint(
            (string) self::text($e, 'method'),
            (string) self::text($e, 'path'),
            (string) self::text($e, 'handler'),
            self::axis(self::get($e, 'authentication')),
            self::axis(self::get($e, 'authorization')),
            array_map('strval', self::members($e, 'dimensions')),
            self::text($e, 'unknown_reason'),
            $acknowledged,
        );
    }

    /** Read a Committed Inventory; throws on a missing key, so a malformed file fails before the boot. */
    public static function fromJson(string $json): self
    {
        $data = Json::parse($json);
        $boot = self::get($data, 'boot_environment');
        $base = self::get($data, 'base_script');
        $expected = [];
        foreach (self::members($data, 'expected_access') as $dimension => $values) {
            $byValue = [];
            foreach (get_object_vars($values) as $value => $access) {
                $byValue[$value] = new Expected(self::list($access, 'authentication'), self::list($access, 'authorization'));
            }
            $expected[$dimension] = $byValue;
        }

        return new self(
            self::text($data, 'schema_version'),
            self::text($data, 'stack'),
            self::text($data, 'discovery_mode'),
            self::text($data, 'coverage'),
            self::text($data, 'coverage_note'),
            self::text($base, 'stack'),
            self::text($base, 'version'),
            new BootEnvironment(
                self::text($boot, 'entry'),
                array_map(fn ($e) => new Env((string) self::text($e, 'name'), (string) self::text($e, 'value'), (string) self::text($e, 'reason')), self::list($boot, 'environ')),
                array_map(fn ($s) => ['target' => self::text($s, 'target'), 'reason' => self::text($s, 'reason')], self::list($boot, 'stubs')),
                array_map(fn ($p) => ['setting' => self::text($p, 'setting'), 'value' => self::get($p, 'value'), 'reason' => self::text($p, 'reason')], self::list($boot, 'pinned')),
            ),
            self::members($data, 'project_dimensions'),
            $expected,
            array_map(self::endpoint(...), self::list($data, 'endpoints')),
        );
    }

    // --- check ---

    /**
     * Diff lines from the Committed Inventory to the regenerated one; empty when they match.
     * Structural, so the committed file's ordering and whitespace never count as a difference.
     *
     * @return list<string>
     */
    public static function check(self $committed, self $currentInventory): array
    {
        $old = self::tree($committed);
        $current = self::fromJson(self::toCanonicalJson($currentInventory)); // compare as written
        $now = self::tree($current);
        $lines = [];
        foreach ($now as $key => $value) {
            if ($key !== 'endpoints' && Json::compact(self::sortKeys($old[$key])) !== Json::compact(self::sortKeys($value))) {
                $lines[] = '~ ' . $key . ': ' . Json::compact($old[$key]) . ' -> ' . Json::compact($value);
            }
        }
        $before = [];
        foreach ($committed->endpoints as $e) {
            if (isset($before[self::identity($e)])) {
                $lines[] = '- ' . self::label($e) . ' (duplicate entry)';
            }
            $before[self::identity($e)] = $e;
        }
        $after = [];
        foreach ($current->endpoints as $e) {
            $after[self::identity($e)] = $e;
        }
        $oldDeclared = array_map('strval', array_keys($committed->projectDimensions));
        $nowDeclared = array_map('strval', array_keys($current->projectDimensions));
        foreach (self::sorted(array_values($after + $before)) as $e) {
            $was = $before[self::identity($e)] ?? null;
            $is = $after[self::identity($e)] ?? null;
            if ($is === null) {
                $lines[] = '- ' . self::label($was);
            } elseif ($was === null) {
                $lines[] = '+ ' . self::label($is) . ' authentication=' . $is->authentication->value . ' authorization=' . $is->authorization->value . (self::isUnknown($is) ? ' [unknown]' : '');
            } else {
                $x = self::flatten(self::endpointTree($was, $oldDeclared));
                $y = self::flatten(self::endpointTree($is, $nowDeclared));
                foreach (array_keys($x + $y) as $name) {
                    if (Json::compact($x[$name] ?? null) !== Json::compact($y[$name] ?? null)) {
                        $lines[] = '~ ' . self::label($is) . ' ' . $name . ': ' . self::shown($x[$name] ?? null) . ' -> ' . self::shown($y[$name] ?? null);
                    }
                }
            }
        }

        return $lines;
    }

    /** Objects with their keys sorted, so key order never counts as a difference (lists keep theirs). */
    private static function sortKeys(mixed $value): mixed
    {
        if ($value instanceof \stdClass) {
            $value = get_object_vars($value);
            if ($value === []) {
                return new \stdClass();
            }
        }
        if (!is_array($value)) {
            return $value;
        }
        if (array_is_list($value)) {
            return array_map(self::sortKeys(...), $value);
        }
        uksort($value, fn ($a, $b) => strcmp((string) $a, (string) $b));

        return array_map(self::sortKeys(...), $value);
    }

    /** @return array<string, mixed> */
    private static function flatten(array $data, string $prefix = ''): array
    {
        $flat = [];
        foreach ($data as $key => $value) {
            if ($value instanceof \stdClass) {
                $value = get_object_vars($value);
                if ($value === []) {
                    continue;
                }
            }
            if (is_array($value) && !array_is_list($value)) {
                $flat += self::flatten($value, $prefix . $key . '.');
            } else {
                $flat[$prefix . $key] = $value;
            }
        }

        return $flat;
    }

    private static function shown(mixed $value): string
    {
        return is_string($value) ? $value : Json::compact($value);
    }

    // --- validation ---

    /** Throw ValidationError naming the first offending endpoint; never write an invalid inventory. */
    public static function validate(self $inventory): void
    {
        if ($inventory->discoveryMode === 'static' && $inventory->coverage !== 'best-effort') {
            throw new ValidationError('static discovery must claim coverage best-effort');
        }
        if ($inventory->coverage === 'best-effort' && ($inventory->coverageNote === null || $inventory->coverageNote === '')) {
            throw new ValidationError('coverage best-effort requires a coverage_note');
        }
        foreach ($inventory->projectDimensions as $name => $values) {
            if ($values === [] || count(array_unique($values)) !== count($values) || in_array('', $values, true)) {
                throw new ValidationError('dimension ' . $name . ' needs a non-empty list of distinct non-empty values');
            }
        }
        self::validateExpected($inventory->expectedAccess, $inventory->projectDimensions);
        $seen = [];
        foreach ($inventory->endpoints as $e) {
            self::validateEndpoint($e, $inventory->projectDimensions);
            if (isset($seen[self::identity($e)])) {
                throw new ValidationError('duplicate endpoint ' . self::label($e));
            }
            $seen[self::identity($e)] = true;
        }
    }

    private static function validateExpected(array $expected, array $projectDimensions): void
    {
        foreach ($expected as $dimension => $values) {
            foreach ($values as $value => $access) {
                $where = 'expected access ' . $dimension . '=' . Json::quote((string) $value);
                if (!in_array((string) $value, $projectDimensions[$dimension] ?? [], true)) {
                    throw new ValidationError($where . ' is not a declared dimension value');
                }
                if ($access->authentication === null || $access->authorization === null) {
                    throw new ValidationError($where . ' needs exactly [' . implode(',', array_keys(self::EXPECTED_AXES)) . ']');
                }
                foreach (self::EXPECTED_AXES as $axis => $allowed) {
                    $listed = $axis === 'authentication' ? $access->authentication : $access->authorization;
                    if ($listed === [] || count(array_unique($listed)) !== count($listed) || array_diff($listed, $allowed) !== []) {
                        throw new ValidationError($where . ': ' . $axis . ' needs a non-empty list of distinct values from ' . implode(', ', $allowed));
                    }
                }
            }
        }
    }

    private static function validateEndpoint(Endpoint $e, array $projectDimensions): void
    {
        $fail = fn (string $message) => throw new ValidationError(self::label($e) . ': ' . $message);
        if (!in_array($e->method, self::METHODS, true)) {
            $fail('method ' . Json::compact($e->method) . ' outside ' . implode(', ', self::METHODS));
        }
        if (!str_starts_with($e->path, '/')) {
            $fail('path must start with /');
        }
        foreach (['authentication' => $e->authentication, 'authorization' => $e->authorization] as $name => $a) {
            $values = $name === 'authentication' ? self::AUTHENTICATION : self::AUTHORIZATION;
            if (!in_array($a->value, $values, true)) {
                $fail($name . '.value ' . Json::compact($a->value) . ' outside the Core Classification');
            }
            if (!in_array($a->layer, self::LAYERS, true)) {
                $fail($name . '.layer ' . Json::compact($a->layer) . ' outside the layers');
            }
            if (($a->value === 'unknown') !== ($a->rule === null)) {
                $fail($name . ': an unknown value has no rule and any other value names one');
            }
            $recognition = $a->rule !== null && str_starts_with($a->rule, 'recognition:');
            if ($recognition !== ($a->evidence !== null && $a->evidence !== '')) {
                $fail($name . ': evidence is set exactly when a Recognition Rule decides');
            }
        }
        if ($e->unknownReason !== null && ($e->unknownReason === '' || !self::isUnknown($e))) {
            $fail('unknown_reason must be non-empty and sit next to an unknown value');
        }
        if ($e->acknowledged && $e->unknownReason === null) {
            $fail('an acknowledged endpoint carries its unknown_reason');
        }
        $declared = array_map('strval', array_keys($projectDimensions));
        $given = array_map('strval', array_keys($e->dimensions));
        sort($declared, SORT_STRING);
        sort($given, SORT_STRING);
        if ($given !== $declared) {
            $fail('dimensions [' . implode(',', $given) . '] must equal project dimensions [' . implode(',', $declared) . ']');
        }
        foreach ($e->dimensions as $dimension => $value) {
            if (!in_array($value, $projectDimensions[$dimension], true)) {
                $fail('dimension ' . $dimension . '=' . Json::quote($value) . ' is not declared');
            }
        }
    }

    /** @return list<Endpoint> */
    public static function unknowns(self $inventory): array
    {
        return array_values(array_filter(self::sorted($inventory->endpoints), self::isUnknown(...)));
    }
}
