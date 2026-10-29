// The map CLI run as a user runs it, inside a copy of fixtures/django-demo: one test per scenario of test.md.

import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, expect, test } from 'vitest';

import { buildData } from '../src/data.ts';

const CLI = join(import.meta.dirname, '..', 'src', 'cli.ts');
const FIXTURE = join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'django-demo');

let project: string;
let gitconfig: string;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'map-'));
  project = join(root, 'django-demo');
  cpSync(FIXTURE, project, { recursive: true, filter: src => !/(\.venv|__pycache__|\.pytest_cache|tests)$/.test(src) });
  copyFileSync(join(FIXTURE, 'expected', 'inventory.json'), join(project, 'tools', 'access-inspector', 'inventory.json'));
  gitconfig = join(root, 'gitconfig');
  writeFileSync(gitconfig, '[user]\n\temail = reviewer@example.com\n');
});

const map = (...args: string[]) => {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' };
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: project, env, encoding: 'utf8' });
  return { status: result.status, out: result.stdout + result.stderr };
};

const logPath = () => join(project, 'tools', 'access-inspector', 'reviews.jsonl');
const log = () => (existsSync(logPath()) ? readFileSync(logPath(), 'utf8') : '');

const edit = (path: string, change: (text: string) => string) => {
  const file = join(project, path);
  const before = readFileSync(file, 'utf8');
  const after = change(before);
  expect(after).not.toBe(before);
  writeFileSync(file, after);
};

const editJson = (path: string, change: (data: Record<string, unknown[]>) => void) =>
  edit(path, text => {
    const data = JSON.parse(text);
    change(data);
    return `${JSON.stringify(data, null, 2)}\n`;
  });

const accept = () => map('decide', '.', 'export-orders', 'clerk', '--verdict', 'accepted', '--reason', 'Clerks export through a manager');

test('Only the roles the code defines are shown', () => {
  expect(buildData(project).roles.map(r => r.id)).toEqual(['anonymous', 'clerk', 'manager', 'superuser']);
});

test('A role reaching some endpoints of a capability is partial', () => {
  const data = buildData(project);
  expect(data.cells.find(c => c.capability === 'export-orders' && c.role === 'clerk')?.state).toBe('partial');
  expect(data.alerts[0]).toMatchObject({ kind: 'undecided', cell: ['export-orders', 'clerk'], text: expect.stringContaining('Export orders for Clerk') });
});

test('An undecided partial capability fails the check', () => {
  const result = map('check', '.');
  expect(result.status).toBe(1);
  expect(result.out).toContain('Export orders for Clerk is partial');
});

test('A decided partial capability passes the check', () => {
  expect(accept()).toMatchObject({ status: 0, out: 'decided accepted: export-orders for clerk\n' });
  const result = map('check', '.');
  expect(result.status, result.out).toBe(0);
  expect(result.out).toContain('open findings: 0');
});

test('A decision goes outdated when the cell changes', () => {
  expect(accept().status).toBe(0);
  editJson('tools/access-map/runtime.json', data => {
    for (const e of data.endpoints as { path: string; permissions: string[] }[]) if (e.path === '/admin/shop/order/export/') e.permissions = ['shop.view_order'];
  });
  const result = map('check', '.');
  expect(result.status).toBe(1);
  expect(result.out).toContain('Export orders for Clerk: decision outdated');
});

test('A decision without a reason is refused', () => {
  const result = map('decide', '.', 'export-orders', 'clerk', '--verdict', 'safe');
  expect(result.status).toBe(2);
  expect(log()).toBe('');
});

test('A finding without a severity is refused', () => {
  const result = map('decide', '.', 'export-orders', 'clerk', '--verdict', 'finding', '--reason', 'r');
  expect(result.status).toBe(2);
  expect(result.out).toContain('severity');
  expect(log()).toBe('');
});

test('A decision on an unknown role is refused', () => {
  const result = map('decide', '.', 'export-orders', 'cashier', '--verdict', 'safe', '--reason', 'No such role');
  expect(result).toMatchObject({ status: 2, out: expect.stringContaining('cashier') });
  expect(log()).toBe('');
});

test('A decision on an unknown capability is refused', () => {
  const result = map('decide', '.', 'refund-orders', 'clerk', '--verdict', 'safe', '--reason', 'r');
  expect(result).toMatchObject({ status: 2, out: expect.stringContaining('refund-orders') });
  expect(log()).toBe('');
});

test('A moved line fails the check', () => {
  edit('shop/admin.py', text => `# moved\n${text}`);
  const result = map('check', '.');
  expect(result.status).toBe(1);
  expect(result.out).toContain('shop/admin.py:24: expected `if not self.has_change_permission(request):`, moved to shop/admin.py:25');
});

test('A vocabulary entry that duplicates a Map Rule fails the check', () => {
  editJson('tools/access-map/vocabulary.json', data => {
    data.roles = [{ id: 'clerk', name: 'Clerk' }, { id: 'manager', kind: 'group', at: 'shop/roles.py:5', reason: 'by hand' }];
  });
  map('pin', '.');
  const result = map('check', '.');
  expect(result.status).toBe(1);
  expect(result.out).toContain('vocabulary role "manager": a Map Rule produces it at shop/roles.py:5');
});

test('A runtime that no longer matches the inventory fails the check', () => {
  editJson('tools/access-map/runtime.json', data => {
    data.endpoints?.push({ method: 'GET', path: '/gone/', handler: 'shop/views.py:99', layers: [], permissions: [], verdict: null, fallback: null, notes: [] });
  });
  const result = map('check', '.');
  expect(result.status).toBe(1);
  expect(result.out).toContain('runtime endpoint GET /gone/ shop/views.py:99 is not in the inventory');
});

test('An invalid vocabulary is an error', () => {
  editJson('tools/access-map/vocabulary.json', data => {
    data.roles?.push({ id: 'auditor', kind: 'admin' });
  });
  const result = map('check', '.');
  expect(result.status).toBe(2);
  expect(result.out).toContain('auditor: kind: "admin"');
});
