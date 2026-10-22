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
