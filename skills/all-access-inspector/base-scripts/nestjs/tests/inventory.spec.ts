import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { type Endpoint, ValidationError, toCanonicalJson, validate } from '../access_inspector/inventory.js';
import { SAMPLES, endpoint, load } from './samples.js';

test('canonical bytes', () => {
  expect(toCanonicalJson(load('canonical.input.json'))).toBe(readFileSync(join(SAMPLES, 'canonical.json'), 'utf8'));
});

test('canonical bytes, empty', () => {
  const text = readFileSync(join(SAMPLES, 'canonical-empty.json'), 'utf8');
  expect(toCanonicalJson(load('canonical-empty.json'))).toBe(text);
});

test('sort by path, then method, then handler, by code point', () => {
  const shuffled = [
    endpoint('GET', '/a/b'),
    endpoint('POST', '/a', 'Z.create'),
    endpoint('DELETE', '/a'),
    endpoint('POST', '/a', 'A.create'),
    endpoint('ANY', '/a'),
    endpoint('GET', '/\u{1F600}'),
    endpoint('GET', '/～'),
  ];
  const lines = toCanonicalJson({ ...load('canonical.input.json'), endpoints: shuffled }).split('\n');
  const order = lines.slice(10, 17).map(line => {
    const e = JSON.parse(line.trim().replace(/,$/, '')) as Endpoint;
    return [e.method, e.path, e.handler];
  });
  expect(order).toEqual([
    ['ANY', '/a', 'ShopController.list'],
    ['DELETE', '/a', 'ShopController.list'],
    ['POST', '/a', 'A.create'],
    ['POST', '/a', 'Z.create'],
    ['GET', '/a/b', 'ShopController.list'],
    ['GET', '/～', 'ShopController.list'],
    ['GET', '/\u{1F600}', 'ShopController.list'],
  ]);
});

describe('validate', () => {
  const base = load('canonical.input.json');
  const invalid = (change: Partial<Endpoint>, message: string | RegExp) =>
    expect(() => validate({ ...base, endpoints: [{ ...endpoint('GET', '/orders/'), ...change }] })).toThrow(message);

  test('accepts the canonical sample', () => validate(base));

  test('dimension keys', () =>
    invalid({ dimensions: { access_tier: 'public', team: 'sales' } }, /GET \/orders\/ \(ShopController.list\): dimensions/));

  test('dimension value', () => invalid({ dimensions: { access_tier: 'partner' } }, 'access_tier="partner" is not declared'));

  test.each([[[]], [['public', 'public']], [['']]])('dimension values list %j', values => {
    expect(() => validate({ ...base, project_dimensions: { tier: values }, endpoints: [] })).toThrow('dimension tier needs');
  });

  test('coverage note', () =>
    expect(() => validate({ ...base, coverage: 'best-effort', coverage_note: null })).toThrow('requires a coverage_note'));

  test('static is best-effort', () => expect(() => validate({ ...base, discovery_mode: 'static' })).toThrow('static discovery'));

  test.each<[Partial<Endpoint>, string]>([
    [{ method: 'TRACE' }, 'method "TRACE"'],
    [{ path: 'orders/' }, 'path must start with /'],
    [{ authentication: { value: 'sso', layer: null, raw: null, rule: 'builtin:x' } }, 'outside the Core Classification'],
    [{ authentication: { value: 'anonymous', layer: 'view' as never, raw: null, rule: 'builtin:x' } }, 'layer "view"'],
    [{ authentication: { value: 'unknown', layer: null, raw: null, rule: 'builtin:x' } }, 'unknown value has no rule'],
    [{ unknown_reason: 'custom' }, 'unknown_reason must'],
  ])('endpoint %j', (change, message) => invalid(change, message));

  test('duplicate', () => {
    const twice = [endpoint('GET', '/orders/'), endpoint('GET', '/orders/')];
    expect(() => validate({ ...base, endpoints: twice })).toThrow(new ValidationError('duplicate endpoint GET /orders/ (ShopController.list)'));
  });
});
