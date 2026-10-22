<?php

declare(strict_types=1);

namespace AccessInspector;

/**
 * One check a request meets, read from access_control, an attribute or API Platform metadata. construct is the check
 * as a Recognition Rule names it; builtin the Built-in Rule that reads it, or null; reason is set when the script
 * cannot read the check at all.
 */
final class Finding
{
    public function __construct(
        public readonly string $construct,
        public readonly ?string $layer,
        public readonly ?string $raw,
        public readonly ?string $builtin,
        public readonly ?string $reason = null,
    ) {
    }
}

/** A Recognition Rule: maps a check, or every path under a prefix, onto the Core Classification. */
final class Rule
{
    public function __construct(
        public readonly string $name,
        public readonly ?string $evidence, // "relative/path.php:line" of the construct the rule interprets
        public readonly ?string $construct,
        public readonly ?string $pathPrefix,
        public readonly ?string $layer, // defaults to the finding's layer; required with pathPrefix
        public readonly ?string $authn,
        public readonly ?string $authz,
        public readonly ?string $safeAuthn = null, // value for GET/HEAD/OPTIONS when it differs, as for a Built-in Rule
        public readonly ?string $safeAuthz = null,
        public readonly ?string $raw = null,
    ) {
    }

    public static function construct(string $name, string $evidence, string $construct, string $authn, string $authz): self
    {
        return new self($name, $evidence, $construct, null, null, $authn, $authz);
    }

    public static function pathPrefix(string $name, string $evidence, string $pathPrefix, string $layer, string $authn, string $authz): self
    {
        return new self($name, $evidence, null, $pathPrefix, $layer, $authn, $authz);
    }

    public function safe(?string $safeAuthn, ?string $safeAuthz): self
    {
        return new self($this->name, $this->evidence, $this->construct, $this->pathPrefix, $this->layer, $this->authn, $this->authz, $safeAuthn, $safeAuthz, $this->raw);
    }

    public function withRaw(string $raw): self
    {
        return new self($this->name, $this->evidence, $this->construct, $this->pathPrefix, $this->layer, $this->authn, $this->authz, $this->safeAuthn, $this->safeAuthz, $raw);
    }
}

/** An Acknowledged Unknown: the written reason an unknown endpoint stays unknown. */
final class Ack
{
    private function __construct(public readonly string $reason, public readonly ?string $construct, public readonly ?string $path)
    {
    }

    public static function construct(string $reason, string $construct): self
    {
        return new self($reason, $construct, null);
    }

    public static function path(string $reason, string $path): self
    {
        return new self($reason, null, $path);
    }
}

/** The two axes of one endpoint; acknowledged when an Acknowledged Unknown gave the reason. */
final class Resolved
{
    public function __construct(public readonly Axis $authentication, public readonly Axis $authorization, public readonly ?string $reason, public readonly bool $acknowledged)
    {
    }
}

final class RuleError extends \RuntimeException
{
}

/** Built-in Rules, Recognition Rules and Acknowledged Unknowns; turns findings into the Core Classification. */
final class Rules
{
    public const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
    public const AUTHENTICATION_STRICTNESS = ['required', 'unknown', 'optional', 'anonymous'];
    public const AUTHORIZATION_STRICTNESS = ['unknown', 'rule', 'none'];

    public const BUILTIN = [
        // the firewall and access_control
        'no_security' => ['anonymous', 'none'],
        'no_firewall' => ['anonymous', 'none'],
        'security_false' => ['anonymous', 'none'],
        'no_access_control' => ['anonymous', 'none'],
        'no_roles' => ['anonymous', 'none'],
        // access attributes, in access_control, #[IsGranted] or denyAccessUnlessGranted()
        'PUBLIC_ACCESS' => ['anonymous', 'none'],
        'IS_AUTHENTICATED' => ['required', 'none'],
        'IS_AUTHENTICATED_FULLY' => ['required', 'none'],
        'IS_AUTHENTICATED_REMEMBERED' => ['required', 'none'],
        'role' => ['required', 'rule'],
        // expression functions
        'is_authenticated' => ['required', 'none'],
        'is_fully_authenticated' => ['required', 'none'],
        'is_remember_me' => ['required', 'none'],
    ];

    /** The Built-in Rule of one access attribute: a ROLE_* is a role, a voter attribute has none. */
    public static function attribute(string $attribute): ?string
    {
        if (in_array($attribute, ['PUBLIC_ACCESS', 'IS_AUTHENTICATED', 'IS_AUTHENTICATED_FULLY', 'IS_AUTHENTICATED_REMEMBERED'], true)) {
            return $attribute;
        }

        return str_starts_with($attribute, 'ROLE_') ? 'role' : null;
    }

    /**
     * The Built-in Rule of access_control's attributes, any of which grants (the default affirmative strategy): none
     * at all lets every request through, and the weakest one decides.
     *
     * @param list<string> $attributes
     */
    public static function attributes(array $attributes): ?string
    {
        if ($attributes === []) {
            return 'no_roles';
        }
        $builtins = array_map(self::attribute(...), $attributes);
        if (in_array(null, $builtins, true)) {
            return null;
        }
        foreach (['PUBLIC_ACCESS', 'IS_AUTHENTICATED_REMEMBERED', 'IS_AUTHENTICATED', 'IS_AUTHENTICATED_FULLY'] as $weakest) {
            if (in_array($weakest, $builtins, true)) {
                return $weakest;
            }
        }

        return 'role';
    }

    /** The Built-in Rule of an expression that is one built-in call with literal arguments, else null. */
    public static function expression(string $text): ?string
    {
        $text = trim($text);
        if (preg_match('/^(is_authenticated|is_fully_authenticated|is_remember_me)\(\)$/', $text, $m)) {
            return $m[1];
        }
        if (preg_match('/^is_granted\(\s*([\'"])([A-Za-z0-9_]+)\1\s*\)$/', $text, $m)) {
            return self::attribute($m[2]);
        }

        return null;
    }

    // --- project ---
    /**
     * Recognition Rules. Each cites the file and line of the construct it interprets; construct is the check exactly as
     * --unknowns shows it in raw, after "-> " for access_control. For one construct the first rule wins, e.g.:
     * Rule::construct('project_view', 'src/Security/ProjectVoter.php:14', "#[IsGranted('PROJECT_VIEW', subject: 'project')]", 'required', 'rule'),
     * Rule::pathPrefix('partner_key', 'src/Security/PartnerKeyAuthenticator.php:22', '/partner/', 'global', 'required', 'none'),
     *
     * @return list<Rule>
     */
    public static function recognition(): array
    {
        return [];
    }

    /**
     * Acknowledged Unknowns, e.g.:
     * Ack::path('GraphQL operations are out of scope; authorization is enforced per resolver', '/graphql'),
     *
     * @return list<Ack>
     */
    public static function acknowledged(): array
    {
        return [];
    }
    // --- end project ---

    /**
     * All checks apply: per axis the strictest component wins, and the first one holding that value is reported.
     * Components are in request order (path rules, then findings: access_control, class, method), so on a tie the
     * check a request meets first is the one reported.
     *
     * @param list<Finding> $findings
     * @param list<Rule>|null $recognition
     * @param list<Ack>|null $acknowledged
     */
    public static function resolveAccess(array $findings, string $method, string $path, ?array $recognition = null, ?array $acknowledged = null): Resolved
    {
        $recognition ??= self::recognition();
        $acknowledged ??= self::acknowledged();
        $own = array_map(fn (Finding $f) => self::component($f, $method, $recognition), $findings);
        $components = [];
        foreach ($recognition as $r) {
            if ($r->pathPrefix !== null && str_starts_with($path, $r->pathPrefix)) {
                $components[] = self::recognised($r, $method, $r->layer, $r->raw);
            }
        }
        $components = [...$components, ...$own];
        if ($components === []) {
            throw new RuleError($method . ' ' . $path . ': no finding to classify');
        }
        $authn = self::strictest(array_column($components, 0), self::AUTHENTICATION_STRICTNESS);
        $authz = self::strictest(array_column($components, 1), self::AUTHORIZATION_STRICTNESS);
        if ($authn->value !== 'unknown' && $authz->value !== 'unknown') {
            return new Resolved($authn, $authz, null, false);
        }
        $unknown = [];
        foreach ($findings as $i => $f) {
            if ($own[$i][0]->value === 'unknown' || $own[$i][1]->value === 'unknown') {
                $unknown[] = $f->construct;
            }
        }
        foreach ($acknowledged as $ack) {
            if ($path === $ack->path || ($ack->construct !== null && in_array($ack->construct, $unknown, true))) {
                return new Resolved($authn, $authz, $ack->reason, true);
            }
        }
        foreach ($findings as $f) {
            if ($f->reason !== null && in_array($f->construct, $unknown, true)) {
                return new Resolved($authn, $authz, $f->reason, false);
            }
        }

        return new Resolved($authn, $authz, null, false);
    }

    /**
     * An ANY endpoint whose checks differ between methods is split into one row per method.
     *
     * @param \Closure(string): list<Finding> $findings
     * @param list<Rule>|null $recognition
     * @return list<string>
     */
    public static function methods(\Closure $findings, string $method, string $path, ?array $recognition = null): array
    {
        if ($method !== 'ANY') {
            return [$method];
        }
        $concrete = array_values(array_filter(Inventory::METHODS, fn ($m) => $m !== 'ANY'));
        $first = self::resolveAccess($findings($concrete[0]), $concrete[0], $path, $recognition, []);
        foreach ($concrete as $m) {
            if (self::resolveAccess($findings($m), $m, $path, $recognition, []) != $first) {
                return $concrete;
            }
        }

        return [$method];
    }

    /**
     * Every Recognition Rule targets one thing and cites a file and line that exist.
     *
     * @param list<Rule> $recognition
     */
    public static function checkRules(array $recognition, string $root): void
    {
        foreach ($recognition as $rule) {
            if (($rule->construct === null) === ($rule->pathPrefix === null)) {
                throw new RuleError('rule ' . $rule->name . ': set exactly one of construct or pathPrefix');
            }
            if ($rule->pathPrefix !== null && $rule->layer === null) {
                throw new RuleError('rule ' . $rule->name . ': a pathPrefix rule needs a layer');
            }
            if ($rule->layer !== null && !in_array($rule->layer, Inventory::LAYERS, true)) {
                throw new RuleError('rule ' . $rule->name . ": layer '" . $rule->layer . "' is not one of global, class, method, framework-default");
            }
            self::checkValue($rule, $rule->authn, self::AUTHENTICATION_STRICTNESS, false);
            self::checkValue($rule, $rule->safeAuthn, self::AUTHENTICATION_STRICTNESS, true);
            self::checkValue($rule, $rule->authz, self::AUTHORIZATION_STRICTNESS, false);
            self::checkValue($rule, $rule->safeAuthz, self::AUTHORIZATION_STRICTNESS, true);
            self::checkEvidence('rule ' . $rule->name, $rule->evidence, $root);
        }
    }

    private static function checkValue(Rule $rule, ?string $value, array $allowed, bool $optional): void
    {
        if ($value === null ? !$optional : !in_array($value, $allowed, true)) {
            throw new RuleError('rule ' . $rule->name . ": '" . $value . "' is not one of " . implode(', ', $allowed));
        }
    }

    private static function checkEvidence(string $owner, ?string $evidence, string $root): void
    {
        $at = $evidence === null ? false : strrpos($evidence, ':');
        $file = $at ? substr($evidence, 0, $at) : '';
        $line = $at ? substr($evidence, $at + 1) : '';
        $source = $file === '' ? false : realpath($root . '/' . $file);
        if ($file === '' || !preg_match('/^\d+$/', $line) || $source === false || !str_starts_with($source, $root . '/') || !is_file($source)) {
            throw new RuleError($owner . ': evidence ' . $evidence . ' does not exist');
        }
        $text = @file_get_contents($source);
        if ($text === false) {
            throw new RuleError($owner . ': evidence ' . $evidence . ' cannot be read');
        }
        $count = substr_count($text, "\n") + 1 - (str_ends_with($text, "\n") ? 1 : 0);
        if ((int) $line < 1 || (int) $line > $count) {
            throw new RuleError($owner . ': evidence ' . $evidence . ' is past the end of the file');
        }
    }

    /** @return array{Axis, Axis} */
    private static function component(Finding $finding, string $method, array $recognition): array
    {
        foreach ($recognition as $rule) {
            if ($finding->construct === $rule->construct) {
                return self::recognised($rule, $method, $rule->layer ?? $finding->layer, $rule->raw ?? $finding->raw);
            }
        }
        $builtin = $finding->reason === null && $finding->builtin !== null ? (self::BUILTIN[$finding->builtin] ?? null) : null;
        if ($builtin === null) {
            $unknown = self::axis('unknown', $finding->layer, $finding->raw, null, null);

            return [$unknown, $unknown];
        }
        $tag = 'builtin:' . $finding->builtin;

        return [self::axis($builtin[0], $finding->layer, $finding->raw, $tag, null), self::axis($builtin[1], $finding->layer, $finding->raw, $tag, null)];
    }

    /** @return array{Axis, Axis} */
    private static function recognised(Rule $rule, string $method, ?string $layer, ?string $raw): array
    {
        $safe = in_array($method, self::SAFE_METHODS, true);
        $authn = $safe && $rule->safeAuthn !== null ? $rule->safeAuthn : $rule->authn;
        $authz = $safe && $rule->safeAuthz !== null ? $rule->safeAuthz : $rule->authz;
        $tag = 'recognition:' . $rule->name;

        return [self::axis($authn, $layer, $raw, $tag, $rule->evidence), self::axis($authz, $layer, $raw, $tag, $rule->evidence)];
    }

    private static function axis(string $value, ?string $layer, ?string $raw, ?string $rule, ?string $evidence): Axis
    {
        $unknown = $value === 'unknown';

        return new Axis($value, $layer, $raw, $unknown ? null : $rule, $unknown ? null : $evidence);
    }

    /** @param list<Axis> $axes */
    private static function strictest(array $axes, array $order): Axis
    {
        $winner = min(array_map(fn (Axis $a) => array_search($a->value, $order, true), $axes));
        foreach ($axes as $a) {
            if (array_search($a->value, $order, true) === $winner) {
                return $a;
            }
        }
        throw new \LogicException('no axis');
    }
}
