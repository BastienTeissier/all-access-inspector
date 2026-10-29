import { describe, expect, test } from 'vitest';

import { type Capability, capabilityList, cell, cells } from '../src/cells.ts';
import { endpoint, role, runtime, vocabulary, who } from './fixtures.ts';

const cap: Capability = {
  id: 'orders.view',
  name: 'See orders',
  sub: null,
  area: 'orders',
  term: 'Order',
  verb: 'read',
  endpoints: [],
  check: 'orders.view',
  at: 'app/models.py:1',
  basis: 'extracted',
  reason: null,
};

const editor = role('editor');
const list = endpoint('GET', '/orders/', who('groups', { roles: ['editor'] }));
const exported = endpoint('GET', '/orders/export/', who('groups', { roles: ['manager'], basis: 'rule' }));
const hidden = endpoint('GET', '/orders/hidden/', who('nobody'));
const decided = endpoint('GET', '/orders/odd/', who('custom', { basis: 'open' }));

describe('cell state', () => {
  test.each([
    ['pass', [list]],
    ['partial', [list, exported]],
    ['partial', [list, hidden]],
    ['no', [exported]],
    ['off', [hidden]],
    ['open', [decided]],
    ['open', [list, decided]],
    ['no', []],
  ] as const)('%s', (state, endpoints) => {
    expect(cell(cap, editor, [...endpoints], runtime(), vocabulary()).state).toBe(state);
  });
});

describe('cell', () => {
  test('basis is the weakest of the endpoints and the scope', () => {
    expect(cell(cap, editor, [list], runtime(), vocabulary()).basis).toBe('extracted');
    expect(cell(cap, editor, [list, exported], runtime(), vocabulary()).basis).toBe('rule');
    const scoped = vocabulary({
      scopes: [{ id: 'own', label: 'Their own orders', at: 'app/admin.py:3', reason: 'r' }],
      scoped: [{ capability: cap.id, role: 'editor', scope: 'own', at: 'app/admin.py:3', reason: 'r' }],
    });
    expect(cell(cap, editor, [list], runtime(), scoped)).toMatchObject({ basis: 'curated', scope: { id: 'own', basis: 'curated' } });
  });

  test('a scope read by a Map Rule is inferred, and shown only on pass or partial', () => {
    const rt = runtime({
      scopes: [{ id: 'own', label: 'Their own orders', at: 'app/admin.py:3', basis: 'extracted' }],
      scoped: [
        { capability: cap.id, role: 'editor', scope: 'own', at: 'app/admin.py:3', basis: 'rule' },
        { capability: cap.id, role: 'manager', scope: 'own', at: 'app/admin.py:3', basis: 'rule' },
      ],
    });
    expect(cell(cap, editor, [list], rt, vocabulary()).scope).toMatchObject({ id: 'own', basis: 'inferred' });
    expect(cell(cap, editor, [list, exported], rt, vocabulary()).scope).toMatchObject({ id: 'own' });
    expect(cell(cap, role('manager'), [list], rt, vocabulary()).scope).toBeNull();
  });

  test('the fingerprint does not depend on the order of the endpoints', () => {
    const a = cell(cap, editor, [list, exported, hidden], runtime(), vocabulary()).seen;
    const b = cell(cap, editor, [hidden, exported, list], runtime(), vocabulary()).seen;
    expect(JSON.stringify(a)).toBe(JSON.stringify({ ...b, who: a.who }));
    expect(b.who).toEqual(a.who);
    expect(a.reached).toEqual([list.key]);
    expect(a.missed).toEqual([exported.key, hidden.key]);
  });
});

describe('capabilityList and cells', () => {
  const rt = runtime({
    capabilities: [
      { id: 'orders.view', area: 'orders', term: 'Order', verb: 'read', endpoints: [['GET', '/orders/', 'app/views.py']], check: 'orders.view', at: 'a.py:1', basis: 'extracted' },
      { id: 'orders.delete', area: 'orders', term: 'Order', verb: 'write', endpoints: [['POST', '/orders/', 'app/views.py']], check: 'orders.delete', at: 'a.py:2', basis: 'extracted' },
    ],
  });
  const v = vocabulary({
    capabilities: [
      { extends: 'orders.view', name: 'See orders' },
      {
        id: 'export',
        name: 'Export orders',
        area: 'orders',
        verb: 'read',
        endpoints: [['GET', '/orders/'], ['HEAD', '/orders/export/']],
        check: 'orders.change',
        evidence: [['app/views.py:9', 'export']],
        reason: 'one task',
        replaces: ['orders.delete'],
      },
    ],
  });

  test('extracted capabilities named by extends, replaced ones dropped, hand-written ones curated', () => {
    expect(capabilityList(rt, v).map(c => [c.id, c.name, c.basis])).toEqual([
      ['orders.view', 'See orders', 'extracted'],
      ['export', 'Export orders', 'curated'],
    ]);
  });

  test('a HEAD in a capability is its GET; a valid decision is joined to its cell', () => {
    const caps = capabilityList(rt, v);
    const computed = cells(caps, [editor], [list, exported], rt, v, [], '2026-10-29');
    const exportCell = computed.cells.find(c => c.capability === 'export');
    expect(exportCell).toMatchObject({ state: 'partial', decision: null });
    const logged = [
      {
        v: 2,
        at: '2026-10-28T10:00:00Z',
        by: 'a@b.c',
        event: 'decided' as const,
        batch: null,
        capability: ['export', 'editor'] as [string, string],
        seen: exportCell!.seen,
        verdict: 'finding' as const,
        reason: 'r',
        severity: 'high' as const,
        line: 1,
      },
      { ...logOn('gone'), line: 2 },
    ];
    const again = cells(caps, [editor], [list, exported], rt, v, logged, '2026-10-29');
    expect(again.cells.find(c => c.capability === 'export')?.decision?.state).toBe('valid');
    expect(again.orphans.map(o => o.key)).toEqual([['gone', 'editor']]);
  });
});

const logOn = (capability: string) => ({
  v: 2,
  at: '2026-10-28T10:00:00Z',
  by: 'a@b.c',
  event: 'decided' as const,
  batch: null,
  capability: [capability, 'editor'] as [string, string],
  seen: { state: 'pass', reached: [], missed: [], who: {} },
  verdict: 'safe' as const,
  reason: 'r',
});
