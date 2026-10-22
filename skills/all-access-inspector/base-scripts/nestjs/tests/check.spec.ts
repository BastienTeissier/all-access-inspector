import { expect, test } from 'vitest';

import { type Axis, check, fromJson } from '../access_inspector/inventory.js';
import { endpoint, load } from './samples.js';

const label = (e: { method: string; path: string; handler: string }) => `${e.method} ${e.path} (${e.handler})`;

test('ignores ordering and whitespace', () => {
  expect(check(load('canonical.input.json'), load('canonical.json'))).toEqual([]);
});

test('three-way diff', () => {
  const committed = load('canonical.json');
  const [gone, kept, ...rest] = committed.endpoints;
  const changed = { ...kept!, authentication: { ...kept!.authentication, value: 'optional' } };
  const unknown: Axis = { value: 'unknown', layer: null, raw: null, rule: null };
  const added = { ...gone!, path: '/hooks/', authentication: unknown, authorization: unknown, unknown_reason: 'custom hook' };
  const diff = check(committed, { ...committed, endpoints: [changed, added, ...rest] });
  expect(diff).toContain(`- ${label(gone!)}`);
  expect(diff).toContain(`+ ${label(added)} authentication=unknown authorization=unknown [unknown]`);
  expect(diff).toContain(`~ ${label(kept!)} authentication.value: ${kept!.authentication.value} -> optional`);
  expect(diff).toHaveLength(3);
});

test('header change', () => {
  const committed = load('canonical.json');
  expect(check(committed, { ...committed, project_dimensions: { access_tier: ['public'] } })).toEqual([
    '~ project_dimensions: {"access_tier": ["public", "customer", "staff"]} -> {"access_tier": ["public"]}',
  ]);
});

test('null to text', () => {
  const committed = load('canonical.json');
  const first = committed.endpoints[0]!;
  const reasoned = { ...first, authorization: { ...first.authorization, raw: 'is_staff (overridden)' } };
  const plain = { ...first, authorization: { ...first.authorization, raw: null } };
  expect(check({ ...committed, endpoints: [plain] }, { ...committed, endpoints: [reasoned] })).toEqual([
    `~ ${label(first)} authorization.raw: null -> is_staff (overridden)`,
  ]);
});

test('flags a duplicated committed entry', () => {
  const current = load('canonical.json');
  const first = current.endpoints[0]!;
  expect(check({ ...current, endpoints: [first, ...current.endpoints] }, current)).toEqual([`- ${label(first)} (duplicate entry)`]);
});

test('a malformed committed inventory throws before any diff', () => {
  expect(() => fromJson('{"schema_version": "1"}')).toThrow();
  expect(() => fromJson(JSON.stringify({ ...load('canonical.json'), endpoints: [{ ...endpoint('GET', '/'), path: undefined }] }))).toThrow(
    'missing key',
  );
});
