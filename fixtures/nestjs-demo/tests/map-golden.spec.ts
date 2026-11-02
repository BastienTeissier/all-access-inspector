// Golden-file tests: run the vendored Map Introspect inside a copy of this fixture.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';

const FIXTURE = join(import.meta.dirname, '..');
const BASE = join(FIXTURE, '..', '..', 'skills', 'all-access-inspector', 'base-scripts', 'nestjs', 'access_map');
const EXPECTED = join(FIXTURE, 'expected', 'runtime.json');
const MAP_CLI = join(FIXTURE, '..', '..', 'skills', 'all-access-inspector', 'map', 'src', 'cli.ts');
const PROJECT_SECTION = /\/\/ --- project ---\n[\s\S]*?\/\/ --- end project ---\n/;

let project: string;

beforeEach(() => {
  project = join(mkdtempSync(join(tmpdir(), 'nestjs-demo-')), 'nestjs-demo');
  const skip = new Set(['node_modules', 'tests', 'expected']);
  cpSync(FIXTURE, project, { recursive: true, filter: source => !skip.has(source.slice(FIXTURE.length + 1)) });
  symlinkSync(join(FIXTURE, 'node_modules'), join(project, 'node_modules'));
});

const run = (args: string[] = []) => {
  const result = spawnSync(join(project, 'tools', 'access-inspector', 'inspect.sh'), ['map', ...args], { cwd: project, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const output = () => join(project, 'tools', 'access-map', 'runtime.json');

const edit = (path: string, old: string, replacement: string) => {
  const file = join(project, path);
  const text = readFileSync(file, 'utf8');
  expect(text).toContain(old);
  writeFileSync(file, text.replace(old, replacement));
};

test('nestjs map golden', () => {
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(output(), 'utf8')).toBe(readFileSync(EXPECTED, 'utf8'));
});

test('nestjs map check clean', () => {
  cpSync(EXPECTED, output());
  const result = run(['--check']);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toBe('runtime up to date\n');
});

test('nestjs map check drift', () => {
  cpSync(EXPECTED, output());
  edit('src/admin/admin.controller.ts', "  @Roles('admin')\n  @Delete(':id')", "  @Delete(':id')");
  const result = run(['--check']);
  expect(result.status, result.stderr).toBe(1);
  expect(result.stdout).toContain('- endpoints /api/admin/users/{id} DELETE AdminController.remove\n');
  expect(result.stdout).toContain('run `tools/access-inspector/inspect.sh map`');
  expect(readFileSync(output(), 'utf8')).toBe(readFileSync(EXPECTED, 'utf8'));
});

test('nestjs map check missing runtime', () => {
  const result = run(['--check']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('tools/access-map/runtime.json not found; generate it first');
});

test('nestjs map check committed runtime missing a key', () => {
  const runtime = JSON.parse(readFileSync(EXPECTED, 'utf8'));
  delete runtime.grants;
  writeFileSync(output(), JSON.stringify(runtime));
  const result = run(['--check']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('access-map: ');
});

test('nestjs map role roles() does not declare', () => {
  edit('src/admin/admin.controller.ts', "  @Roles('admin')\n  @Delete(':id')", "  @Roles('owner')\n  @Delete(':id')");
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  const runtime = JSON.parse(readFileSync(output(), 'utf8'));
  const remove = runtime.endpoints.find((e: { method: string }) => e.method === 'DELETE');
  expect(remove.verdict).toMatchObject({ kind: 'groups', roles: ['owner'] });
  cpSync(join(FIXTURE, 'expected', 'inventory.json'), join(project, 'tools', 'access-inspector', 'inventory.json'));
  const check = spawnSync(process.execPath, [MAP_CLI, 'check', '.'], { cwd: project, encoding: 'utf8' });
  expect(check.status, check.stdout + check.stderr).toBe(1);
  expect(check.stdout).toContain('a check names role owner, which is not a role');
});

test('nestjs map usage error', () => {
  expect(run(['--table']).status).toBe(2);
});

test('nestjs map vendored copy matches the Base Script', () => {
  const vendored = join(FIXTURE, 'tools', 'access-map');
  const names = readdirSync(BASE).sort();
  expect(readdirSync(vendored).filter(n => n.endsWith('.ts')).sort()).toEqual(names);
  for (const name of names) {
    const strip = (dir: string) => readFileSync(join(dir, name), 'utf8').replace(PROJECT_SECTION, '');
    expect(strip(vendored), name).toBe(strip(BASE));
  }
});
