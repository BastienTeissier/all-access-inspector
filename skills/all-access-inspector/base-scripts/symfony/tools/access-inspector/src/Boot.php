<?php

declare(strict_types=1);

namespace AccessInspector;

use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Dotenv\Dotenv;

final class BootError extends \RuntimeException
{
}

/** The pinned Boot Environment: kernel, environment and the variables production sets, each with its reason. */
final class Boot
{
    // --- project ---
    /** The kernel production runs and the environment it runs with. */
    public const KERNEL = 'App\Kernel';
    public const ENV = 'prod';

    /**
     * Variables production sets that the committed .env files lack: production values only, never a secret, e.g.
     * new Env('DATABASE_URL', 'postgresql://inventory-placeholder/app', 'database unreachable outside production'),
     *
     * @return list<Env>
     */
    public static function environ(): array
    {
        return [];
    }
    // --- end project ---

    /** @param list<Env> $environ */
    public static function checkEnviron(array $environ): void
    {
        $names = [];
        foreach ($environ as $env) {
            if (!preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $env->name)) {
                throw new BootError("environment variable '" . $env->name . "' is not a valid name");
            }
            if (in_array($env->name, ['APP_ENV', 'APP_DEBUG'], true)) {
                throw new BootError('set the environment with Boot::ENV, not ' . $env->name);
            }
            if (isset($names[$env->name])) {
                throw new BootError('environment variable ' . $env->name . ' is set twice');
            }
            if (trim($env->reason) === '') {
                throw new BootError('environment variable ' . $env->name . ' needs a reason');
            }
            $names[$env->name] = true;
        }
    }

    /**
     * Boot the kernel as production runs it: ENVIRON first, then the committed .env files, never a *.local one.
     * The router and the access maps are read here, so an environment variable they lack fails as a boot failure.
     *
     * @param list<Env> $environ
     */
    public static function boot(string $root, string $dir, array $environ): ContainerInterface
    {
        self::checkEnviron($environ);
        $variables = ['APP_ENV' => self::ENV, 'APP_DEBUG' => '0'];
        foreach ($environ as $env) {
            $variables[$env->name] = $env->value;
        }
        foreach ($variables as $name => $value) {
            $_SERVER[$name] = $_ENV[$name] = $value;
        }
        try {
            if (class_exists(Dotenv::class)) {
                $files = array_filter([$root . '/.env', $root . '/.env.' . self::ENV], 'is_file');
                if ($files !== []) {
                    (new Dotenv())->load(...$files);
                }
            }
            if (!class_exists(self::KERNEL)) {
                throw new BootError('class ' . self::KERNEL . ' not found');
            }
            if ((new \ReflectionClass(self::KERNEL))->isFinal()) {
                throw new BootError(self::KERNEL . ' is final; the inspector extends it to build into a directory of its own');
            }
            if (!class_exists(ProjectKernel::class, false)) {
                class_alias(self::KERNEL, ProjectKernel::class);
            }
            require_once __DIR__ . '/Kernel.php';
            InspectorKernel::$root = $root;
            InspectorKernel::$dir = $dir;
            $kernel = new InspectorKernel(self::ENV, false);
            $kernel->boot();
            $container = $kernel->getContainer();
            $container->get('router')->getRouteCollection();
            foreach ([InspectorKernel::ACCESS_MAP, InspectorKernel::FIREWALL_MAP] as $id) {
                if ($container->has($id)) {
                    $container->get($id);
                }
            }

            return $container;
        } catch (\Throwable $e) {
            throw new BootError('cannot boot ' . self::KERNEL . ' with env ' . self::ENV . ': ' . (new \ReflectionClass($e))->getShortName() . ': ' . $e->getMessage(), 0, $e);
        }
    }

    /** @param list<Env> $environ */
    public static function environment(array $environ): BootEnvironment
    {
        return new BootEnvironment(self::ENV, $environ, [], []);
    }
}
