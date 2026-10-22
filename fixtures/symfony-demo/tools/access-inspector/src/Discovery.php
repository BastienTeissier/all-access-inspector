<?php

declare(strict_types=1);

namespace AccessInspector;

use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Routing\Exception\ExceptionInterface;
use Symfony\Component\Routing\Generator\UrlGenerator;
use Symfony\Component\Routing\RequestContext;
use Symfony\Component\Routing\Route;
use Symfony\Component\Routing\RouteCollection;

/** One route as the inventory lists it; findings are the checks of the route itself, by method; no sample when none fits. */
final class Mapped
{
    /** @param \Closure(string): list<Finding> $findings */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly ?string $sample,
        public readonly string $handler,
        public readonly \Closure $findings,
    ) {
    }
}

/** Every route the router serves, as it serves them: the first route of a method and path wins. */
final class Discovery
{
    /** @return list<Mapped> */
    public static function discover(ContainerInterface $container, string $root): array
    {
        $controllers = $container->hasParameter(InspectorKernel::CONTROLLERS) ? $container->getParameter(InspectorKernel::CONTROLLERS) : [];
        $mapped = [];
        $seen = [];
        foreach ($container->get('router')->getRouteCollection()->all() as $route) {
            $path = self::path($route->getPath());
            $methods = $route->getMethods() ?: ['ANY'];
            if (in_array('GET', $methods, true) && !in_array('HEAD', $methods, true)) {
                $methods[] = 'HEAD'; // the router serves HEAD with the GET route
            }
            [$handler, $findings] = ApiPlatform::isOperation($route)
                ? self::operation($container, $route, $root)
                : self::controller($route, $controllers, $root);
            foreach (self::unanswered($methods, $path, $seen) as $method) {
                $seen[$method . ' ' . $path] = true;
                $mapped[] = new Mapped($method, $path, self::sample($route), $handler, $findings);
            }
        }

        return $mapped;
    }

    /**
     * The methods no earlier route on the path answers; an ANY route behind one of them keeps only the others.
     *
     * @param list<string> $methods
     * @param array<string, true> $seen
     * @return list<string>
     */
    private static function unanswered(array $methods, string $path, array $seen): array
    {
        if (isset($seen['ANY ' . $path])) {
            return [];
        }
        $taken = fn (string $m) => isset($seen[$m . ' ' . $path]);
        $concrete = array_values(array_diff(Inventory::METHODS, ['ANY']));
        if ($methods === ['ANY'] && array_filter($concrete, $taken) !== []) {
            $methods = $concrete;
        }

        return array_values(array_filter($methods, fn (string $m) => !$taken($m)));
    }

    /** {!slug} is {slug} for the inventory. */
    public static function path(string $path): string
    {
        return preg_replace('/\{!/', '{', $path);
    }

    public const UNSAMPLED = 'no request path satisfies the route requirements, so the firewall and access_control cannot be decided';

    /**
     * A request path the route matches, as the router generates it: defaults kept (an optional trailing parameter such as
     * .{_format} left out), every other parameter the default, a literal its requirement lists, 1 or a. Null when no
     * such value satisfies a requirement.
     */
    public static function sample(Route $route): ?string
    {
        $routes = new RouteCollection();
        $routes->add('sample', $route);
        $generator = new UrlGenerator($routes, new RequestContext());
        $variables = $route->compile()->getVariables();
        foreach ([array_filter($variables, fn (string $name) => !$route->hasDefault($name)), $variables] as $names) {
            $parameters = [];
            foreach ($names as $name) {
                $value = self::value($route, $name);
                if ($value === null) {
                    return null;
                }
                $parameters[$name] = $value;
            }
            try {
                return $generator->generate('sample', $parameters);
            } catch (ExceptionInterface) {
                // a default the requirement rejects: try again with every parameter filled
            }
        }

        return null;
    }

    private static function value(Route $route, string $name): ?string
    {
        $requirement = $route->getRequirement($name);
        if ($requirement === null) {
            return '1';
        }
        $default = $route->getDefault($name);
        $literals = preg_match('/^[\w.-]+(\|[\w.-]+)*$/', $requirement) ? explode('|', $requirement) : [];
        foreach ([...(is_scalar($default) ? [(string) $default] : []), ...$literals, '1', 'a'] as $candidate) {
            if (preg_match('{^(?:' . $requirement . ')$}sDu', $candidate) === 1) {
                return $candidate;
            }
        }

        return null;
    }

    /** The path relative to the project for a file of its own, null for a vendor or unknown file. */
    public static function projectFile(string|false $file, string $root): ?string
    {
        if ($file === false || !str_starts_with($file, $root . '/') || str_starts_with($file, $root . '/vendor/')) {
            return null;
        }

        return substr($file, strlen($root) + 1);
    }

    /** @return array{string, \Closure(string): list<Finding>} */
    private static function operation(ContainerInterface $container, Route $route, string $root): array
    {
        [$operation, $resourceSecurity, $reason] = ApiPlatform::operation($container, $route);
        $findings = ApiPlatform::findings($operation, $resourceSecurity, $reason);

        return [ApiPlatform::handler($route, $operation, $root), fn (string $method) => $findings];
    }

    /**
     * The controller method a route names, by class or by service id.
     *
     * @param array<string, string> $controllers
     * @return array{string, \Closure(string): list<Finding>}
     */
    private static function controller(Route $route, array $controllers, string $root): array
    {
        $controller = $route->getDefault('_controller');
        $text = is_string($controller) ? $controller : json_encode($controller);
        if (is_string($controller)) {
            [$id, $name] = str_contains($controller, '::') ? explode('::', $controller, 2) : [$controller, '__invoke'];
            $class = class_exists($id) ? $id : ($controllers[$id] ?? null);
            if ($class !== null && class_exists($class) && method_exists($class, $name)) {
                $method = new \ReflectionMethod($class, $name);
                $file = self::projectFile($method->getFileName(), $root);
                $handler = $file !== null ? $file . ':' . $method->getStartLine() : $class . '::' . $name;

                return [$handler, fn (string $http) => Attributes::findings(new \ReflectionClass($class), $method, $http, $root)];
            }
        }
        $unresolved = [new Finding('controller ' . $text, 'method', $text, null, 'controller ' . $text . ' cannot be resolved')];

        return [$text, fn (string $http) => $unresolved];
    }
}
