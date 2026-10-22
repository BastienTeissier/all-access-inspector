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
        $findings = [];
        foreach (self::calls(implode('', $lines)) as $call) {
            if (preg_match('/^denyAccessUnlessGranted\(\s*([\'"])([A-Za-z0-9_]+)\1\s*\)$/', $call, $m) && Rules::attribute($m[2]) !== null) {
                $findings[] = new Finding($call, 'method', $call, Rules::attribute($m[2]));
            } else {
                $findings[] = new Finding($call, 'method', $call, null, self::BODY);
            }
        }

        return $findings;
    }

    /**
     * Each ->denyAccessUnlessGranted(…) or ::denyAccessUnlessGranted(…) call in the source, as written, up to its balanced
     * closing parenthesis: read from PHP tokens, so a comment or a string naming it is no call.
     *
     * @return list<string>
     */
    private static function calls(string $source): array
    {
        $tokens = array_values(array_filter(\PhpToken::tokenize('<?php ' . $source), fn (\PhpToken $t) => !$t->is([T_OPEN_TAG])));
        $significant = fn (int $i, int $step) => self::next($tokens, $i, $step);
        $calls = [];
        foreach ($tokens as $i => $token) {
            $before = $significant($i, -1);
            $after = $significant($i, 1);
            if (!$token->is(T_STRING) || $token->text !== 'denyAccessUnlessGranted' || $before === null || $after === null
                || !$tokens[$before]->is([T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR, T_DOUBLE_COLON]) || $tokens[$after]->text !== '(') {
                continue;
            }
            $call = '';
            $depth = 0;
            for ($j = $i; $j < count($tokens); ++$j) {
                $call .= $tokens[$j]->text;
                $depth += match ($tokens[$j]->text) { '(' => 1, ')' => -1, default => 0 };
                if ($j >= $after && $depth === 0) {
                    break;
                }
            }
            $calls[] = $call;
        }

        return $calls;
    }

    /** @param list<\PhpToken> $tokens */
    private static function next(array $tokens, int $i, int $step): ?int
    {
        for ($j = $i + $step; isset($tokens[$j]); $j += $step) {
            if (!$tokens[$j]->is([T_WHITESPACE, T_COMMENT, T_DOC_COMMENT])) {
                return $j;
            }
        }

        return null;
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
