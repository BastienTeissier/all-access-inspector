import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { type Runtime, check, lineOf, toCanonicalJson } from '../access_map/runtime.js';

const GOLDEN = join(import.meta.dirname, '../../../../../fixtures/django-demo/expected/runtime.json');

const runtime = (more: Runtime = {}): Runtime => {
  const endpoint = { method: 'GET', path: '/b/', handler: 'h', layers: [] };
  return {
    schema_version: '1',
    stack: 'django',
    base_script: { stack: 'django', version: '0.4.0' },
    about: { reads: 'r', holds: [], heuristics: [], command: 'c' },
    roles: [
      { id: 'manager', kind: 'group', at: 'r.py:3' },
      { id: 'clerk', kind: 'group', at: 'r.py:2' },
    ],
    areas: [],
    grants: {
      'shop.view': [
        { role: 'manager', at: 'r.py:3' },
        { role: 'clerk', at: 'r.py:2' },
      ],
    },
    scopes: [],
    scoped: [],
    capabilities: [],
    endpoints: [endpoint, { ...endpoint, path: '/a/' }],
    first_party: ['shop.views.Ping', 'core.views.Hook'],
    snippets: { 'z.py:1': 'z', 'a.py:1': 'a' },
    ...more,
  };
};

test('the canonical JSON is byte-equal to the Python serialisation', () => {
  const text = readFileSync(GOLDEN, 'utf8');
  expect(toCanonicalJson(JSON.parse(text) as Runtime)).toBe(text);
});

test('the runtime serialisation is sorted and stable', () => {
  const text = toCanonicalJson(runtime());
  expect(text.endsWith('}\n')).toBe(true);
  const data = JSON.parse(text) as { roles: { id: string }[]; endpoints: { path: string }[]; first_party: string[]; snippets: object };
  expect(Object.keys(data)).toEqual(Object.keys(runtime()));
  expect(data.roles.map(r => r.id)).toEqual(['clerk', 'manager']);
  expect(data.endpoints.map(e => e.path)).toEqual(['/a/', '/b/']);
  expect(data.first_party).toEqual(['core.views.Hook', 'shop.views.Ping']);
  expect(Object.keys(data.snippets)).toEqual(['a.py:1', 'z.py:1']);
  expect(text).toContain('    {"id": "clerk", "kind": "group", "at": "r.py:2"},\n');
  expect(text).toContain('  "scopes": [],\n');
  expect(toCanonicalJson(JSON.parse(text) as Runtime)).toBe(text);
});

test('check names each changed, removed and added fact', () => {
  const committed = runtime();
  expect(check(committed, runtime())).toEqual([]);
  expect(check(committed, runtime({ roles: [{ id: 'clerk', kind: 'group', at: 'r.py:4' }], grants: {}, stack: 'other' }))).toEqual([
    '~ stack: "django" -> "other"',
    '~ roles clerk: {"id": "clerk", "kind": "group", "at": "r.py:2"} -> {"id": "clerk", "kind": "group", "at": "r.py:4"}',
    '- roles manager',
    '- grants shop.view',
  ]);
  expect(check(committed, runtime({ scopes: [{ id: 'own', label: 'Own', at: 'q.py:1', basis: 'inferred' }] }))).toEqual([
    '+ scopes own: {"id": "own", "label": "Own", "at": "q.py:1", "basis": "inferred"}',
  ]);
});

test('check orders endpoints by path, then method', () => {
  const endpoint = (method: string, path: string) => ({ method, path, handler: 'h', layers: [] });
  const committed = runtime({ endpoints: [] });
  expect(check(committed, runtime({ endpoints: [endpoint('GET', '/a/b/'), endpoint('POST', '/a/'), endpoint('GET', '/a/')] })).map(l => l.split(':')[0])).toEqual([
    '+ endpoints /a/ GET h',
    '+ endpoints /a/ POST h',
    '+ endpoints /a/b/ GET h',
  ]);
});

test('lineOf names the missing text', () => {
  const root = mkdtempSync(join(tmpdir(), 'map-'));
  writeFileSync(join(root, 'a.ts'), 'const x = 1;\n');
  expect(lineOf(root, 'a.ts', 'const x = 1')).toBe('a.ts:1');
  expect(() => lineOf(root, 'a.ts', 'y = 2')).toThrow('a.ts: no line contains "y = 2"');
});
