import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { VocabularyError, duplicates, loadVocabulary, missingTerms, pin, references, staleReferences } from '../src/vocabulary.ts';
import { runtime, vocabulary } from './fixtures.ts';

const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'access-map-'));
  mkdirSync(join(dir, 'shop'));
  writeFileSync(join(dir, 'shop', 'views.py'), ['import x', '', 'def orders(request):', '    return x', ''].join('\n'));
  return dir;
};

/** A vocabulary whose only reference is in one area's `defined_at`, or in several written in a reason. */
const citing = (text: string, anchors?: Record<string, string>) =>
  vocabulary({ areas: [{ id: 'a', name: 'A', term: 'A', defined_at: null }], scopes: [{ id: 's', label: 'S', at: 'shop/views.py:3', reason: text }], anchors });

describe('references', () => {
  test('finds every file:line in strings, nested anywhere but under anchors and stack', () => {
    const v = { ...citing('see shop/views.py:3 and app/Guard.java:12, templates/x.html:4, docs/roles.md:7', { 'old/file.py:1': 'x' }), stack: { admin_actions: ['shop/admin.py:9'] } };
    expect([...references(v)].sort()).toEqual(['app/Guard.java:12', 'docs/roles.md:7', 'shop/views.py:3', 'templates/x.html:4']);
  });
});

describe('staleReferences', () => {
  test('a reference without an anchor must be pinned', () => {
    expect(staleReferences(project(), citing('r'))).toEqual(['shop/views.py:3: no anchor, run map pin']);
  });

  test('an anchored reference whose line still matches is fine; an unused anchor is reported', () => {
    const v = citing('r', { 'shop/views.py:3': 'def orders(request):', 'shop/views.py:9': 'gone' });
    expect(staleReferences(project(), v)).toEqual(['shop/views.py:9: anchor no longer used']);
  });

  test('a line that moved says where, a line that is gone says so', () => {
    const v = citing('shop/views.py:1 and shop/views.py:4', {
      'shop/views.py:1': 'def orders(request):',
      'shop/views.py:3': 'def orders(request):',
      'shop/views.py:4': 'nowhere',
    });
    expect(staleReferences(project(), v)).toEqual([
      'shop/views.py:1: expected `def orders(request):`, moved to shop/views.py:3',
      'shop/views.py:4: expected `nowhere`, line is gone',
    ]);
  });
});

describe('pin', () => {
  test('records the text of unpinned references, keeps existing anchors, skips blank lines', () => {
    const dir = project();
    const path = join(dir, 'vocabulary.json');
    const v = citing('shop/views.py:2, shop/views.py:1', { 'shop/views.py:1': 'kept as is' });
    expect(pin(dir, path, v)).toEqual(['shop/views.py:2: blank or missing line, not pinned', 'pinned shop/views.py:3: def orders(request):']);
    const written = JSON.parse(readFileSync(path, 'utf8'));
    expect(written.anchors).toEqual({ 'shop/views.py:1': 'kept as is', 'shop/views.py:3': 'def orders(request):' });
    expect(staleReferences(dir, written)).toEqual(['shop/views.py:2: no anchor, run map pin', 'shop/views.py:1: expected `kept as is`, line is gone']);
  });
});

describe('missingTerms', () => {
  test('a term absent from CONTEXT.md is a problem; no CONTEXT.md, no problem', () => {
    const dir = project();
    expect(missingTerms(dir, ['Order'])).toEqual([]);
    writeFileSync(join(dir, 'CONTEXT.md'), '- **Order**: a purchase.\n');
    expect(missingTerms(dir, ['Order', 'Invoice', 'Invoice'])).toEqual(['term "Invoice" is not in CONTEXT.md']);
  });
});

describe('duplicates', () => {
  test('a vocabulary entry a Map Rule or the introspect already produces is a problem', () => {
    const rt = runtime({
      roles: [{ id: 'clerk', kind: 'group', at: 'shop/roles.py:4', basis: 'rule', includes: [], staff: null }],
      capabilities: [{ id: 'shop.order.view', area: 'shop.order', term: 'Order', verb: 'read', endpoints: [], check: 'shop.view_order', at: 'shop/models.py:8', basis: 'extracted' }],
      scoped: [{ capability: 'shop.order.view', role: 'clerk', scope: 'own', at: 'shop/admin.py:17', basis: 'rule' }],
    });
    const v = vocabulary({
      roles: [
        { id: 'clerk', name: 'Clerk' },
        { id: 'clerk', kind: 'group', at: 'docs/x.md:1', reason: 'r' },
      ],
      capabilities: [
        { extends: 'shop.order.view', name: 'See orders' },
        { id: 'shop.order.view', name: 'See', area: 'shop.order', verb: 'read', endpoints: [['GET', '/']], check: '', evidence: [['a.py:1', 'x']], reason: 'r' },
      ],
      scoped: [{ capability: 'shop.order.view', role: 'clerk', scope: 'own', at: 'shop/admin.py:17', reason: 'r' }],
    });
    expect(duplicates(v, rt)).toEqual([
      'vocabulary role "clerk": a Map Rule produces it at shop/roles.py:4, name it with {id, name} only',
      'vocabulary capability "shop.order.view": the Map Introspect reads it at shop/models.py:8, use {extends: "shop.order.view", name}',
      'vocabulary scoped "shop.order.view" for "clerk": a Map Rule produces it',
    ]);
  });
});

describe('loadVocabulary', () => {
  const load = (data: unknown) => {
    const path = join(project(), 'vocabulary.json');
    writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data));
    return () => loadVocabulary(path);
  };

  test.each([
    ['not JSON', '{', 'not valid JSON'],
    ['no roles', { areas: [], capabilities: [] }, 'roles: required list'],
    ['a bad kind', { areas: [], capabilities: [], roles: [{ id: 'auditor', kind: 'admin' }] }, 'roles[0] auditor: kind: "admin" is not signed_in, superuser or group'],
    ['a hand-written role with no reason', { areas: [], capabilities: [], roles: [{ id: 'ops', kind: 'group', at: 'a.py:1' }] }, 'roles[0] ops: reason: required'],
    ['a capability with no evidence', { areas: [], roles: [], capabilities: [{ id: 'x', name: 'X', area: 'a', verb: 'read', endpoints: [['GET', '/']], check: '', evidence: [], reason: 'r' }] }, 'capabilities[0] x: evidence'],
  ])('%s is a VocabularyError', (_, data, message) => {
    expect(load(data)).toThrow(VocabularyError);
    expect(load(data)).toThrow(message);
  });

  test('a valid vocabulary loads', () => {
    expect(load(vocabulary())()).toEqual(vocabulary());
  });
});
