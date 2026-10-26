<?php

declare(strict_types=1);

namespace AccessInspector;

use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\ExpressionLanguage\Expression;
use Symfony\Component\HttpFoundation\ChainRequestMatcher;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestMatcher\MethodRequestMatcher;
use Symfony\Component\HttpFoundation\RequestMatcher\PathRequestMatcher;
use Symfony\Component\Security\Http\AccessMap;

/**
 * The firewall a request meets and the first access_control entry it matches, read from the security services the
 * kernel built. Their private fields are read by reflection: a change there reads as unknown, never as a crash.
 */
final class AccessControlResolver
{
    public const INTERNALS_CHANGED = 'Symfony Security internals changed';

    public function __construct(private readonly ContainerInterface $container)
    {
    }

    public function resolve(string $method, string $path): Finding
    {
        if (!$this->container->hasParameter(InspectorKernel::SECURITY) || $this->container->getParameter(InspectorKernel::SECURITY) !== true) {
            return new Finding('no_security', 'framework-default', null, 'no_security');
        }
        foreach ([InspectorKernel::FIREWALL_MAP => 'security.firewall.map', InspectorKernel::ACCESS_MAP => 'security.access_map'] as $alias => $id) {
            if (!$this->container->has($alias)) {
                return new Finding('symfony-security', 'global', 'access_control', null, self::INTERNALS_CHANGED . ': no service ' . $id);
            }
        }
        $request = Request::create($path, $method);
        try {
            $firewall = $this->container->get(InspectorKernel::FIREWALL_MAP)->getFirewallConfig($request);
            if ($firewall === null) {
                return new Finding('no_firewall', 'framework-default', null, 'no_firewall');
            }
            $name = $firewall->getName();
            if (!$firewall->isSecurityEnabled()) {
                return new Finding('security: false', 'global', $name . ': security: false', 'security_false');
            }
            $map = (new \ReflectionProperty(AccessMap::class, 'map'))->getValue($this->container->get(InspectorKernel::ACCESS_MAP));
            foreach (array_values($map) as $i => [$matcher, $attributes]) {
                $finding = $this->entry($i + 1, $name, $matcher, $attributes, $request);
                if ($finding !== null) {
                    return $finding;
                }
            }

            return new Finding('no_access_control', 'framework-default', $name . ': no access_control entry', 'no_access_control');
        } catch (\ReflectionException|\Error $e) {
            $short = (new \ReflectionClass($e))->getShortName();

            return new Finding('symfony-security', 'global', 'access_control', null, self::INTERNALS_CHANGED . ': ' . $short . ': ' . $e->getMessage());
        }
    }

    /** The entry's finding when it applies to the request, null when the request goes on to the next one. */
    private function entry(int $n, string $firewall, ?object $matcher, array $attributes, Request $request): ?Finding
    {
        $what = self::attributes($attributes);
        if ($matcher === null) {
            return self::applied($firewall, '', $what, $attributes);
        }
        if (!$matcher instanceof ChainRequestMatcher) {
            $where = self::describe($matcher);

            return self::conditional($firewall, $where, $what, 'access_control entry ' . $n . ' uses ' . $where . '; the script cannot tell which requests it matches');
        }
        $read = [];
        $conditions = [];
        foreach ((new \ReflectionProperty(ChainRequestMatcher::class, 'matchers'))->getValue($matcher) as $sub) {
            if ($sub instanceof PathRequestMatcher || $sub instanceof MethodRequestMatcher) {
                if (!$sub->matches($request)) {
                    return null;
                }
                $read[] = $sub instanceof PathRequestMatcher
                    ? (new \ReflectionProperty(PathRequestMatcher::class, 'regexp'))->getValue($sub)
                    : '[' . implode(', ', (new \ReflectionProperty(MethodRequestMatcher::class, 'methods'))->getValue($sub)) . ']';
            } else {
                $conditions[] = self::describe($sub);
            }
        }
        $where = implode(' ', [...$read, ...$conditions]);
        if ($conditions !== []) {
            return self::conditional($firewall, $where, $what, 'access_control entry ' . $n . ' applies only when ' . implode(' and ', $conditions)
                . ' match; other requests go on to the next entry');
        }

        return self::applied($firewall, $where, $what, $attributes);
    }

    private static function applied(string $firewall, string $where, string $what, array $attributes): Finding
    {
        $strings = array_filter($attributes, 'is_string');
        $builtin = count($strings) === count($attributes)
            ? Rules::attributes(array_values($strings))
            : (count($attributes) === 1 && $attributes[array_key_first($attributes)] instanceof Expression ? Rules::expression((string) $attributes[array_key_first($attributes)]) : null);

        return new Finding($what, 'global', $firewall . ': ' . ltrim($where . ' -> ' . $what), $builtin);
    }

    private static function conditional(string $firewall, string $where, string $what, string $reason): Finding
    {
        $entry = $where . ' -> ' . $what;

        return new Finding($entry, 'global', $firewall . ': ' . $entry, null, $reason);
    }

    /** Roles as listed, an allow_if expression as allow_if: <expression>. */
    private static function attributes(array $attributes): string
    {
        return implode(', ', array_map(fn ($a) => $a instanceof Expression ? 'allow_if: ' . $a : (is_string($a) ? $a : get_debug_type($a)), $attributes));
    }

    /** A request matcher as its short name without RequestMatcher, then its settings: ips=10.0.0.0/8. */
    private static function describe(object $matcher): string
    {
        $object = new \ReflectionObject($matcher);
        $name = strtolower(preg_replace('/RequestMatcher$/', '', $object->getShortName()) ?: $object->getShortName());
        $settings = [];
        foreach ($object->getProperties() as $property) {
            $value = $property->getValue($matcher);
            $settings[] = is_array($value)
                ? implode(',', array_map(fn ($v) => is_scalar($v) ? (string) $v : get_debug_type($v), $value))
                : (is_scalar($value) || $value === null ? var_export($value, true) : get_debug_type($value));
        }

        return $name . '=' . implode(';', $settings);
    }
}
