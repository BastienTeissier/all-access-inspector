<?php

declare(strict_types=1);

namespace AccessInspector;

use Symfony\Component\DependencyInjection\Compiler\CompilerPassInterface;
use Symfony\Component\DependencyInjection\Compiler\PassConfig;
use Symfony\Component\DependencyInjection\ContainerBuilder;

/**
 * The project's kernel, built into a directory of its own so neither its cache nor its logs are touched, and with the
 * services the inspector reads made public. Boot aliases the project's kernel class as ProjectKernel first.
 */
final class InspectorKernel extends ProjectKernel
{
    public const ACCESS_MAP = 'access_inspector.access_map';
    public const FIREWALL_MAP = 'access_inspector.firewall_map';
    public const RESOURCE_METADATA = 'access_inspector.resource_metadata';
    public const CONTROLLERS = 'access_inspector.controllers';
    public const SECURITY = 'access_inspector.security';

    public static string $root = '';
    public static string $dir = '';

    public function getProjectDir(): string
    {
        return self::$root;
    }

    public function getCacheDir(): string
    {
        return self::$dir . '/cache/' . $this->environment;
    }

    public function getBuildDir(): string
    {
        return $this->getCacheDir();
    }

    public function getLogDir(): string
    {
        return self::$dir . '/log';
    }

    protected function build(ContainerBuilder $container): void
    {
        parent::build($container);
        $container->addCompilerPass(new class implements CompilerPassInterface {
            public function process(ContainerBuilder $container): void
            {
                $aliases = [
                    InspectorKernel::ACCESS_MAP => 'security.access_map',
                    InspectorKernel::FIREWALL_MAP => 'security.firewall.map',
                    InspectorKernel::RESOURCE_METADATA => ApiPlatform::FACTORY,
                ];
                foreach ($aliases as $alias => $id) {
                    while ($container->hasAlias($id)) {
                        $id = (string) $container->getAlias($id);
                    }
                    if ($container->hasDefinition($id)) {
                        $container->setAlias($alias, $id)->setPublic(true);
                    }
                }
                // With SecurityBundle registered, a map missing above is a moved internal, not a project without security.
                $container->setParameter(InspectorKernel::SECURITY, $container->hasExtension('security'));
                // A route names its controller by service id or class; the class is what the inventory shows.
                $classes = [];
                foreach ($container->getDefinitions() as $id => $definition) {
                    $class = $definition->getClass();
                    if ($id !== $class && !$definition->isAbstract() && is_string($class) && !str_starts_with($id, '.')) {
                        $classes[$id] = $container->getParameterBag()->resolveValue($class);
                    }
                }
                $container->setParameter(InspectorKernel::CONTROLLERS, $classes);
            }
        }, PassConfig::TYPE_BEFORE_REMOVING);
    }
}
