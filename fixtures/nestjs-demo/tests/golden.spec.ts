// Golden-file tests: run the vendored Adapted Script inside a copy of this fixture.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';

const FIXTURE = join(import.meta.dirname, '..');
const BASE_SCRIPT = join(FIXTURE, '..', '..', 'skills', 'all-access-inspector', 'base-scripts', 'nestjs', 'access_inspector');
const EXPECTED = join(FIXTURE, 'expected', 'inventory.json');
const PROJECT_SECTION = /\/\/ --- project ---\n[\s\S]*?\/\/ --- end project ---\n/;

interface Axis {
  value: string;
  layer: string | null;
  raw: string | null;
  rule: string | null;
}
interface Endpoint {
  method: string;
  path: string;
  handler: string;
  authentication: Axis;
  authorization: Axis;
  unknown_reason: string | null;
}

let project: string;

beforeEach(() => {
  project = join(mkdtempSync(join(tmpdir(), 'nestjs-demo-')), 'nestjs-demo');
  const skip = new Set(['node_modules', 'tests', 'expected']);
  cpSync(FIXTURE, project, { recursive: true, filter: source => !skip.has(source.slice(FIXTURE.length + 1)) });
  symlinkSync(join(FIXTURE, 'node_modules'), join(project, 'node_modules'));
});

const run = (args: string[] = [], options: { cwd?: string; env?: Record<string, string> } = {}) => {
  const result = spawnSync(join(project, 'tools', 'access-inspector', 'inspect.sh'), args, {
    cwd: options.cwd ?? project,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const output = () => join(project, 'tools', 'access-inspector', 'inventory.json');

const edit = (path: string, old: string, replacement: string) => {
  const file = join(project, path);
  const text = readFileSync(file, 'utf8');
  expect(text).toContain(old);
  writeFileSync(file, text.replace(old, replacement));
};

const expected = (): Endpoint[] => (JSON.parse(readFileSync(EXPECTED, 'utf8')) as { endpoints: Endpoint[] }).endpoints;

const find = (method: string, path: string): Endpoint => expected().find(e => e.method === method && e.path === path)!;

test('nestjs golden', () => {
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(output(), 'utf8')).toBe(readFileSync(EXPECTED, 'utf8'));
});

test('nestjs golden classifications', () => {
  // a @Public() route: the global guard's metadata rule
  expect(find('GET', '/api/products').authentication).toEqual({
    value: 'anonymous',
    layer: 'global',
    raw: 'SessionGuard',
    rule: 'recognition:session_public',
  });
  expect(find('GET', '/api/admin/users/stats').authentication.rule).toBe('recognition:session');
  // @Roles on the handler, RolesGuard on the controller; no @Roles reads none
  expect(find('DELETE', '/api/admin/users/{id}').authorization).toEqual({
    value: 'rule',
    layer: 'class',
    raw: 'RolesGuard roles=["admin"]',
    rule: 'recognition:roles',
  });
  expect(find('GET', '/api/admin/users/stats').authorization.value).toBe('none');
  // passport, under a versioned path
  expect(find('PATCH', '/api/v1/account/me').authentication).toEqual({
    value: 'required',
    layer: 'class',
    raw: "AuthGuard('jwt')",
    rule: 'builtin:AuthGuard',
  });
  // the global prefix is excluded on /health; RouterModule mounts the admin module
  expect(find('GET', '/health')).toBeDefined();
  expect(find('GET', '/api/admin/users')).toBeDefined();
  // middleware on a prefix
  expect(find('GET', '/api/partner/orders').authentication.rule).toBe('recognition:partner_key');
  // @All() and the body-reading guard
  expect(find('ANY', '/api/webhooks/payments').unknown_reason).toContain('SignatureGuard');
  // the Express router outside Nest
  expect(find('GET', '/legacy/status').unknown_reason).toBe('mounted on Express outside Nest; its access checks are not readable');
  // HEAD beside each GET, ThrottlerGuard never shown
  const endpoints = expected();
  const gets = endpoints.filter(e => e.method === 'GET').map(e => e.path);
  expect(endpoints.filter(e => e.method === 'HEAD').map(e => e.path)).toEqual(gets);
  expect(JSON.stringify(endpoints)).not.toContain('Throttler');
});

test('nestjs unknowns output', () => {
  const result = run(['--unknowns']);
  expect(result.status, result.stderr).toBe(0);
  const unknowns = result.stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Endpoint);
  expect(unknowns.map(e => `${e.method} ${e.path}`)).toEqual([
    'ANY /api/webhooks/payments',
    'GET /legacy/status',
    'HEAD /legacy/status',
  ]);
  expect(unknowns.every(e => e.unknown_reason)).toBe(true);
  expect(existsSync(output())).toBe(false);
});

test('nestjs table does not write', () => {
  cpSync(EXPECTED, output());
  const before = statSync(output()).mtimeMs;
  const result = run(['--table']);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trimEnd().split('\n')).toHaveLength(expected().length + 1);
  expect(statSync(output()).mtimeMs).toBe(before);
});

test('nestjs determinism', () => {
  expect(run().status).toBe(0);
  const first = readFileSync(output(), 'utf8');
  expect(run([], { cwd: tmpdir() }).status).toBe(0);
  expect(readFileSync(output(), 'utf8')).toBe(first);
});

test('nestjs environ overrides the shell', () => {
  const result = run([], { env: { NODE_ENV: 'development', JWT_SECRET: '' } });
  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(output(), 'utf8')).toBe(readFileSync(EXPECTED, 'utf8'));
});

test('nestjs boot failure', () => {
  edit(
    'tools/access-inspector/boot.ts',
    "  { name: 'JWT_SECRET', value: 'inventory-placeholder', reason: 'secret required at boot by src/auth/jwt.strategy.ts' },\n",
    '',
  );
  const result = run([], { env: { JWT_SECRET: '' } });
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('environment variable JWT_SECRET is required');
  expect(result.stderr).toContain('cannot boot root module src/app.module.js#AppModule');
  expect(existsSync(output())).toBe(false);
});

test('nestjs check clean', () => {
  const committed = JSON.parse(readFileSync(EXPECTED, 'utf8')) as { endpoints: Endpoint[] };
  committed.endpoints.reverse();
  writeFileSync(output(), JSON.stringify(committed, null, 4));
  const before = readFileSync(output(), 'utf8');
  const result = run(['--check']);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toBe('inventory up to date\n');
  expect(readFileSync(output(), 'utf8')).toBe(before);
});

test('nestjs check drift', () => {
  cpSync(EXPECTED, output());
  edit('src/admin/admin.controller.ts', "  @Roles('admin')\n  @Delete(':id')", "  @Delete(':id')");
  const result = run(['--check']);
  expect(result.status, result.stderr).toBe(1);
  const remove = 'DELETE /api/admin/users/{id} (AdminController.remove)';
  expect(result.stdout).toContain(`~ ${remove} authorization.value: rule -> none`);
  expect(result.stdout).toContain('run `tools/access-inspector/inspect.sh`');
  expect(readFileSync(output(), 'utf8')).toBe(readFileSync(EXPECTED, 'utf8'));
});

test('nestjs check missing inventory', () => {
  const result = run(['--check']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('tools/access-inspector/inventory.json not found');
  expect(result.stderr).toContain('generate it first');
});

test('nestjs check unreadable inventory', () => {
  writeFileSync(output(), '<<<<<<< HEAD\n');
  const result = run(['--check']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('cannot read tools/access-inspector/inventory.json');
  expect(readFileSync(output(), 'utf8')).toBe('<<<<<<< HEAD\n');
});

test('nestjs missing dimension', () => {
  edit('tools/access-inspector/dimensions.ts', 'when: () => true', "when: e => e.path !== '/health'");
  const result = run();
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("GET /health (HealthController.check): no rule assigns dimension 'access_tier'");
  expect(existsSync(output())).toBe(false);
});

test('nestjs usage error', () => {
  expect(run(['--bogus']).status).toBe(2);
});

test('nestjs vendored copy matches the Base Script', () => {
  const vendored = join(FIXTURE, 'tools', 'access-inspector');
  const names = readdirSync(BASE_SCRIPT).sort();
  expect(readdirSync(vendored).sort()).toEqual(names);
  for (const name of names) {
    const strip = (dir: string) => readFileSync(join(dir, name), 'utf8').replace(PROJECT_SECTION, '');
    expect(strip(vendored), name).toBe(strip(BASE_SCRIPT));
  }
});
