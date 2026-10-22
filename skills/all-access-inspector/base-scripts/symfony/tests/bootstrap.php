<?php

declare(strict_types=1);

require dirname(__DIR__) . '/vendor/autoload.php';
// Kernel.php extends the project's kernel, which only a project has.
foreach (glob(dirname(__DIR__) . '/tools/access-inspector/src/*.php') as $file) {
    if (basename($file) !== 'Kernel.php') {
        require_once $file;
    }
}
require_once __DIR__ . '/Samples.php';
require_once __DIR__ . '/Fixtures/ShopController.php';

// The kernel the inspector extends, as a project would have it.
class TestKernel extends Symfony\Component\HttpKernel\Kernel
{
    public function registerBundles(): iterable
    {
        return [];
    }

    public function registerContainerConfiguration(Symfony\Component\Config\Loader\LoaderInterface $loader): void
    {
    }
}
class_alias(TestKernel::class, 'AccessInspector\ProjectKernel');
require_once dirname(__DIR__) . '/tools/access-inspector/src/Kernel.php';
