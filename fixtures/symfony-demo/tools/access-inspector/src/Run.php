<?php

declare(strict_types=1);

namespace AccessInspector;

use Symfony\Component\DependencyInjection\ContainerInterface;

/** Boot, inspect and write or compare; returns the exit status and the lines for stdout and stderr. */
final class Run
{
    public const HERE = 'tools/access-inspector';
    public const COMMITTED = self::HERE . '/inventory.json';
    public const COMMAND = 'php ' . self::HERE . '/inspect.php';

    public static function build(ContainerInterface $container, string $root): Inventory
    {
        $resolver = new AccessControlResolver($container);
        $endpoints = [];
        foreach (Discovery::discover($container, $root) as $mapped) {
            $global = fn (string $method) => $mapped->sample === null
                ? new Finding('route requirements', 'global', 'access_control', null, Discovery::UNSAMPLED)
                : $resolver->resolve($method, $mapped->sample);
            $findings = fn (string $method) => [$global($method), ...($mapped->findings)($method)];
            foreach (Rules::methods($findings, $mapped->method, $mapped->path) as $method) {
                // an ANY kept whole classifies the same for every method
                $resolved = Rules::resolveAccess($findings($method === 'ANY' ? 'GET' : $method), $method, $mapped->path);
                $endpoints[] = new Endpoint($method, $mapped->path, $mapped->handler, $resolved->authentication, $resolved->authorization, [], $resolved->reason, $resolved->acknowledged);
            }
        }
        // in inventory order, so a missing dimension names the same endpoint on every run
        $endpoints = array_map(fn (Endpoint $e) => $e->withDimensions(Dimensions::assign($e)), Inventory::sorted($endpoints));
        $version = trim((string) file_get_contents($root . '/' . self::HERE . '/VERSION'));

        return new Inventory(Inventory::SCHEMA_VERSION, 'symfony', 'runtime', 'complete', null, 'symfony', $version, Boot::environment(Boot::environ()), Dimensions::DIMENSIONS, Dimensions::expected(), $endpoints);
    }

    /** @return array{int, list<string>, list<string>} */
    public static function main(string $mode, string $root): array
    {
        $output = $root . '/' . self::COMMITTED;
        $before = null;
        if ($mode === 'check') {
            // an unusable Committed Inventory fails before paying for the boot
            if (!is_file($output)) {
                return [2, [], ['access-inspector: ' . self::COMMITTED . ' not found; generate it first with `' . self::COMMAND . '` and commit it']];
            }
            try {
                $text = @file_get_contents($output);
                if ($text === false) {
                    throw new \RuntimeException('unreadable');
                }
                $before = Inventory::fromJson($text);
            } catch (\Throwable $e) {
                return [2, [], ['access-inspector: cannot read ' . self::COMMITTED . ': ' . $e->getMessage()]];
            }
        }
        $dir = sys_get_temp_dir() . '/access-inspector-' . bin2hex(random_bytes(6));
        try {
            Rules::checkRules(Rules::recognition(), $root);
            $result = self::build(Boot::boot($root, $dir, Boot::environ()), $root);
            Inventory::validate($result);
        } catch (RuleError|MissingDimension|ValidationError $e) {
            return [2, [], ['access-inspector: ' . $e->getMessage()]];
        } catch (\Throwable $e) {
            $cause = $e instanceof BootError && $e->getPrevious() !== null ? $e->getPrevious() : $e;
            $trace = $e instanceof BootError && $e->getPrevious() === null ? [] : [rtrim((string) $cause)];

            return [2, [], [...$trace, 'access-inspector: ' . $e->getMessage()]];
        } finally {
            self::remove($dir);
        }
        if ($before !== null) {
            $diff = Inventory::check($before, $result);
            if ($diff === []) {
                return [0, ['inventory up to date'], []];
            }

            return [1, [implode("\n", $diff), "\n" . self::COMMITTED . ' differs from the endpoints this code serves.'
                . "\nIf the change is intended, run `" . self::COMMAND . '` and commit ' . self::COMMITTED . '.'], []];
        }
        switch ($mode) {
            case 'table':
                return [0, [Table::render($result)], []];
            case 'unknowns':
                return [0, array_map(fn (Endpoint $e) => Inventory::compact($e, $result), Inventory::unknowns($result)), []];
        }
        $temporary = $output . '.tmp';
        if (@file_put_contents($temporary, Inventory::toCanonicalJson($result)) === false || !@rename($temporary, $output)) {
            return [2, [], ['access-inspector: cannot write ' . self::COMMITTED . ': ' . (error_get_last()['message'] ?? 'unknown error')]];
        }

        return [0, [], []];
    }

    private static function remove(string $path): void
    {
        if (is_dir($path) && !is_link($path)) {
            foreach (scandir($path) ?: [] as $entry) {
                if ($entry !== '.' && $entry !== '..') {
                    self::remove($path . '/' . $entry);
                }
            }
            @rmdir($path);
        } elseif (file_exists($path) || is_link($path)) {
            @unlink($path);
        }
    }
}
