import { describe, expect, test } from 'vitest';

import { foldHead, inside, keyOf } from '../src/inventory.ts';
import { EXPECTED, axis, endpoint } from './build.ts';

describe('keyOf', () => {
  test('strips the trailing line only', () => {
    expect(keyOf({ method: 'GET', path: '/x', handler: 'moi/api/x/view.py:27' })).toEqual(['GET', '/x', 'moi/api/x/view.py']);
    expect(keyOf({ method: 'GET', path: '/x', handler: 'django.views.generic.base.RedirectView' })[2]).toBe('django.views.generic.base.RedirectView');
    expect(keyOf({ method: 'GET', path: '/x', handler: 'a.py:12:3' })[2]).toBe('a.py:12');
  });
});

describe('foldHead', () => {
  test('a HEAD equal to its GET is folded into it, a different one keeps its row', () => {
    const rows = foldHead([
      endpoint('GET', '/a'),
      endpoint('HEAD', '/a'),
      endpoint('GET', '/b'),
      endpoint('HEAD', '/b', 'required', 'none'),
    ]);
    expect(rows.map(r => `${r.method} ${r.path} ${r.head}`)).toEqual(['GET /a true', 'GET /b false', 'HEAD /b false']);
  });
});

describe('inside', () => {
  test('both axes listed is inside, one not listed is outside', () => {
    expect(inside(endpoint('GET', '/a'), EXPECTED)).toBe(true);
    expect(inside(endpoint('GET', '/a', 'required', 'none'), EXPECTED)).toBe(false);
  });

  test('two dimensions, one says no, is outside', () => {
    const expected = { ...EXPECTED, tenant: { shared: { authentication: ['anonymous'], authorization: ['none'] } } };
    expect(inside(endpoint('GET', '/a', 'required', 'rule', { dimensions: { zone: 'user', tenant: 'shared' } }), expected)).toBe(false);
  });

  test('no expectation, or an unknown axis, is null', () => {
    expect(inside(endpoint('GET', '/a', 'required', 'rule', { dimensions: { zone: 'partner' } }), EXPECTED)).toBeNull();
    expect(inside(endpoint('GET', '/a', 'required', 'rule', { dimensions: {} }), EXPECTED)).toBeNull();
    expect(inside({ ...endpoint('GET', '/a'), authorization: axis('unknown') }, EXPECTED)).toBeNull();
  });
});
