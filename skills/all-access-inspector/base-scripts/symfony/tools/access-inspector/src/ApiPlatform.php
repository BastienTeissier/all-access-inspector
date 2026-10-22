<?php

declare(strict_types=1);

namespace AccessInspector;

use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Routing\Route;

/** API Platform operations: their security expressions, read from the resource metadata API Platform enforces. */
final class ApiPlatform
{
    public const FACTORY = 'api_platform.metadata.resource.metadata_collection_factory';
    public const UNAVAILABLE = 'API Platform metadata unavailable';

    public static function isOperation(Route $route): bool
    {
        return is_string($route->getDefault('_api_resource_class')) && is_string($route->getDefault('_api_operation_name'));
    }

    /**
     * The operation the route serves and the resource-level security it may inherit, or the reason neither can be read.
     *
     * @return array{?object, ?string, ?string} operation, resource security, reason
     */
    public static function operation(ContainerInterface $container, Route $route): array
    {
        if (!$container->has(InspectorKernel::RESOURCE_METADATA)) {
            return [null, null, self::UNAVAILABLE . ': no service ' . self::FACTORY];
        }
        $name = $route->getDefault('_api_operation_name');
        try {
            foreach ($container->get(InspectorKernel::RESOURCE_METADATA)->create($route->getDefault('_api_resource_class')) as $resource) {
                foreach ($resource->getOperations() ?? [] as $operation) {
                    if ($operation->getName() === $name) {
                        return [$operation, $resource->getSecurity(), null];
                    }
                }
            }
        } catch (\Throwable $e) {
            return [null, null, self::UNAVAILABLE . ': ' . (new \ReflectionClass($e))->getShortName() . ': ' . $e->getMessage()];
        }

        return [null, null, self::UNAVAILABLE . ': no operation ' . $name];
    }

    /**
     * security, then security_post_denormalize: at class layer when the resource declares it, else at method layer.
     *
     * @return list<Finding>
     */
    public static function findings(?object $operation, ?string $resourceSecurity, ?string $reason): array
    {
        if ($operation === null) {
            return [new Finding('api_platform', null, null, null, $reason)];
        }
        $findings = [];
        foreach (['security' => $operation->getSecurity(), 'security_post_denormalize' => $operation->getSecurityPostDenormalize()] as $key => $expression) {
            if ($expression === null || $expression === '') {
                continue;
            }
            $text = $key . ': ' . $expression;
            $layer = $key === 'security' && $expression === $resourceSecurity ? 'class' : 'method';
            $findings[] = new Finding($text, $layer, $text, Rules::expression($expression));
        }

        return $findings;
    }

    /** The resource file at the line declaring the operation when one line does, else at the class; a vendor class by name. */
    public static function handler(Route $route, ?object $operation, string $root): string
    {
        $class = new \ReflectionClass($route->getDefault('_api_resource_class'));
        $file = Discovery::projectFile($class->getFileName(), $root);
        if ($file === null) {
            return $class->getName();
        }
        $line = $class->getStartLine();
        if ($operation !== null) {
            $short = (new \ReflectionClass($operation))->getShortName();
            $lines = preg_grep('/\bnew\s+' . preg_quote($short, '/') . '\s*\(/', file($class->getFileName()) ?: []);
            if (count($lines) === 1) {
                $line = array_key_first($lines) + 1;
            }
        }

        return $file . ':' . $line;
    }
}
