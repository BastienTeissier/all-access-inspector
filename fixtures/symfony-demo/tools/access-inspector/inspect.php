<?php

// Adapted Script entrypoint: php tools/access-inspector/inspect.php [--check | --table | --unknowns]
//   (no option)  write tools/access-inspector/inventory.json
//   --check      exit 1 with a per-endpoint diff when inventory.json is out of date; write nothing
//   --table      print a table; write nothing
//   --unknowns   print unknown endpoints as JSON lines; write nothing
// Exit codes: 0 ok, 1 drift (--check), 2 boot, rule, dimension or validation error.

declare(strict_types=1);

namespace AccessInspector;

ini_set('display_errors', 'stderr');
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);

$modes = ['' => 'write', '--check' => 'check', '--table' => 'table', '--unknowns' => 'unknowns'];
$mode = $modes[$argv[1] ?? ''] ?? null;
if ($argc > 2 || $mode === null) {
    fwrite(STDERR, "usage: php tools/access-inspector/inspect.php [--check | --table | --unknowns]\n");
    exit(2);
}
$root = (string) realpath(dirname(__DIR__, 2));
if (!is_file($root . '/vendor/autoload.php')) {
    fwrite(STDERR, "access-inspector: $root/vendor/autoload.php not found; run composer install first\n");
    exit(2);
}
require $root . '/vendor/autoload.php';
// Kernel.php extends the project's kernel, so Boot loads it once that kernel is known.
foreach (glob(__DIR__ . '/src/*.php') as $file) {
    if (basename($file) !== 'Kernel.php') {
        require_once $file;
    }
}
[$status, $out, $err] = Run::main($mode, $root);
foreach ($out as $line) {
    fwrite(STDOUT, $line . "\n");
}
foreach ($err as $line) {
    fwrite(STDERR, $line . "\n");
}
exit($status);
