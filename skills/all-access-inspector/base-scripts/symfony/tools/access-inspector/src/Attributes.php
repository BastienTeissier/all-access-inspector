<?php

declare(strict_types=1);

namespace AccessInspector;

use Symfony\Component\ExpressionLanguage\Expression;
use Symfony\Component\Security\Http\Attribute\IsGranted;

/** The checks a controller declares: #[IsGranted] on its class and method, and denyAccessUnlessGranted() in its body. */
final class Attributes
{
    public const SENSIO_SECURITY = 'Sensio\Bundle\FrameworkExtraBundle\Configuration\Security';
    public const BODY = 'voter check in handler body';

    /** @return list<Finding> */
    public static function findings(\ReflectionClass $class, \ReflectionMethod $method, string $http, string $root): array
    {
        $findings = [];
        foreach (['class' => $class, 'method' => $method] as $layer => $target) {
            foreach ($target->getAttributes() as $attribute) {
                $finding = self::attribute($attribute, $layer, $http);
                if ($finding !== null) {
                    $findings[] = $finding;
                }
            }
        }

        return [...$findings, ...self::body($method, $root)];
    }

    private static function attribute(\ReflectionAttribute $attribute, string $layer, string $http): ?Finding
    {
        $name = $attribute->getName();
        if ($name === IsGranted::class || is_subclass_of($name, IsGranted::class)) {
            $text = '#[IsGranted(' . self::arguments($attribute->getArguments()) . ')]';
            try {
                $granted = $attribute->newInstance();
            } catch (\Throwable $e) {
                return new Finding($text, $layer, $text, null, 'unreadable #[IsGranted]: ' . $e->getMessage());
            }
            // An IsGranted older than its methods: argument applies to every method.
            $methods = property_exists($granted, 'methods') ? $granted->methods : [];
            if ($methods !== [] && !in_array($http, $methods, true)) {
                return null;
            }
            $builtin = match (true) {
                is_string($granted->attribute) => Rules::attribute($granted->attribute),
                $granted->attribute instanceof Expression => Rules::expression((string) $granted->attribute),
                default => null,
            };

            return new Finding($text, $layer, $text, $builtin);
        }
        if ($name === self::SENSIO_SECURITY) {
            $expression = $attribute->getArguments()[0] ?? $attribute->getArguments()['expression'] ?? '';
            $text = '#[Security(' . self::arguments($attribute->getArguments()) . ')]';

            return new Finding($text, $layer, $text, is_string($expression) ? Rules::expression($expression) : null);
        }

        return null;
    }

    /**
     * Each denyAccessUnlessGranted() call in a project handler's body, as written; one access attribute alone is read.
     *
     * @return list<Finding>
     */
    private static function body(\ReflectionMethod $method, string $root): array
    {
        if (Discovery::projectFile($method->getFileName(), $root) === null) {
            return [];
        }
        $lines = array_slice(file($method->getFileName()) ?: [], $method->getStartLine() - 1, $method->getEndLine() - $method->getStartLine() + 1);
        $source = implode('', $lines);
        $findings = [];
        $offset = 0;
        while (($at = strpos($source, 'denyAccessUnlessGranted(', $offset)) !== false) {
            $call = self::call($source, $at);
            $offset = $at + strlen($call);
            if (preg_match('/^denyAccessUnlessGranted\(\s*([\'"])([A-Za-z0-9_]+)\1\s*\)$/', $call, $m) && Rules::attribute($m[2]) !== null) {
                $findings[] = new Finding($call, 'method', $call, Rules::attribute($m[2]));
            } else {
                $findings[] = new Finding($call, 'method', $call, null, self::BODY);
            }
        }

        return $findings;
    }

    /** The call starting at $at, up to its balanced closing parenthesis. */
    private static function call(string $source, int $at): string
    {
        $depth = 0;
        for ($i = strpos($source, '(', $at); $i < strlen($source); ++$i) {
            $depth += match ($source[$i]) { '(' => 1, ')' => -1, default => 0 };
            if ($depth === 0) {
                return substr($source, $at, $i - $at + 1);
            }
        }

        return substr($source, $at);
    }

    /** Attribute arguments as PHP source: strings quoted, an Expression as new Expression('…'), a closure as closure. */
    public static function arguments(array $arguments): string
    {
        $parts = [];
        foreach ($arguments as $key => $value) {
            $parts[] = (is_string($key) ? $key . ': ' : '') . self::value($value);
        }

        return implode(', ', $parts);
    }

    private static function value(mixed $value): string
    {
        return match (true) {
            is_string($value) => "'" . addcslashes($value, "'\\") . "'",
            $value instanceof Expression => "new Expression('" . addcslashes((string) $value, "'\\") . "')",
            $value instanceof \Closure => 'closure',
            is_array($value) => '[' . (array_is_list($value) ? implode(', ', array_map(self::value(...), $value)) : self::arguments($value)) . ']',
            $value === null => 'null',
            is_bool($value) => $value ? 'true' : 'false',
            is_object($value) => 'new ' . (new \ReflectionClass($value))->getShortName() . '()',
            default => (string) $value,
        };
    }
}
