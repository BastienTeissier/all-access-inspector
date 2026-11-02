import { describe, expect, test } from 'vitest';

import type { Capability } from '../src/cells.ts';
import { coverage, gaps, packageOf } from '../src/coverage.ts';
import type { MapEndpoint } from '../src/join.ts';
import { endpoint, who } from './fixtures.ts';

const at = (method: string, path: string, handler = 'app/views.py:1', domain: string | null = null): MapEndpoint => ({
  ...endpoint(method, path, who('signed_in')),
  key: [method, path, handler.replace(/:\d+$/, '')],
  handler,
  domain,
});

const capability = (id: string, area: string, name = id): Capability => ({
  id,
  name,
  sub: null,
  area,
  term: 'Order',
  verb: 'read',
  endpoints: [],
  check: id,
  at: null,
  basis: 'extracted',
  reason: null,
  derived: null,
});

const firstParty = (handler: string) => /:\d+$/.test(handler);

const list = at('GET', '/orders/');
const change = at('POST', '/orders/{id}/change/');
const redirect = at('GET', '/orders/{id}/', 'django.views.generic.base.RedirectView');
const exported = at('GET', '/orders/export/');
const health = at('GET', '/health/', 'app/views.py:9', 'ops');
const stray = at('GET', '/stray/');
const login = at('GET', '/accounts/login/', 'allauth.account.views.LoginView');
const index = at('GET', '/admin/', 'django.contrib.admin.sites.AdminSite.index');

const view = capability('orders.view', 'orders', 'View orders');
const edit = capability('orders.change', 'orders', 'Change order');

const report = (endpoints: MapEndpoint[], extra: { folded?: boolean; term?: string | null; caps?: Capability[] } = {}) => {
  const caps = extra.caps ?? [view, edit];
  return coverage({
    areas: [{ id: 'orders', name: 'Orders', term: extra.term === undefined ? 'Order' : extra.term, folded: extra.folded ?? false, capabilities: caps }],
    found: [
      { cap: view, found: [list] },
      { cap: edit, found: [change, list] },
    ],
    endpoints,
    domains: [{ id: 'ops', name: 'Operations', prefixes: ['/health/'] }],
    firstParty,
  });
};

describe('coverage', () => {
  test('an endpoint two capabilities list counts once; a gap under an area path counts in that area', () => {
    const c = report([list, change, redirect, exported]);
    expect(c).toMatchObject({ covered: 2, total: 4 });
    expect(c.areas).toEqual([{ id: 'orders', name: 'Orders', covered: 2, total: 4, gaps: [exported.key] }]);
    expect(c.third_party).toEqual({ total: 1, packages: [{ name: 'django', count: 1, endpoints: [redirect.key] }] });
  });

  test('a gap no area owns goes to its domain, else to no area', () => {
    const c = report([list, change, health, stray]);
    expect(c.areas.map(a => [a.id, a.name, a.covered, a.gaps])).toEqual([
      ['orders', 'Orders', 2, []],
      ['ops', 'Operations', 0, [health.key]],
      ['no area', 'no area', 0, [stray.key]],
    ]);
  });

  test('a covered root or parameter-first path owns no gap', () => {
    const home = at('GET', '/');
    const page = at('GET', '/{slug}/');
    const c = coverage({
      areas: [{ id: 'pages', name: 'Pages', term: 'Page', folded: false, capabilities: [view] }],
      found: [{ cap: { ...view, area: 'pages' }, found: [home, page] }],
      endpoints: [home, page, health, stray],
      domains: [{ id: 'ops', name: 'Operations', prefixes: ['/health/'] }],
      firstParty,
    });
    expect(c.areas.map(a => [a.id, a.total, a.gaps])).toEqual([
      ['pages', 2, []],
      ['ops', 1, [health.key]],
      ['no area', 1, [stray.key]],
    ]);
  });

  test('third-party gaps are counted per package, a django.contrib app by its name', () => {
    expect(report([list, change, login, index]).third_party.packages.map(p => [p.name, p.count])).toEqual([
      ['admin', 1],
      ['allauth', 1],
    ]);
    expect(packageOf('allauth.account.views.LoginView')).toBe('allauth');
    expect(packageOf('django.contrib.admin.sites.AdminSite.index')).toBe('admin');
  });

  test('full coverage leaves no gap', () => {
    const c = report([list, change]);
    expect(c).toMatchObject({ covered: 2, total: 2, third_party: { total: 0, packages: [] } });
    expect(c.areas.every(a => !a.gaps.length)).toBe(true);
  });

  test('the gaps are each area with first-party gaps, then the third-party handlers, no endpoint twice', () => {
    const lines = gaps(report([list, change, redirect, exported, health, login]));
    expect(lines).toEqual([
      { id: 'orders', name: 'Orders', endpoints: [exported.key] },
      { id: 'ops', name: 'Operations', endpoints: [health.key] },
      { id: 'third-party', name: 'Third-party handlers', endpoints: [login.key, redirect.key] },
    ]);
    const keys = lines.flatMap(l => l.endpoints).map(k => JSON.stringify(k));
    expect(new Set(keys).size).toBe(keys.length);
    expect(gaps(report([list, change]))).toEqual([]);
  });

  test('unnamed and untermed list unfolded areas only', () => {
    const unnamed = capability('orders.delete', 'orders');
    expect(report([list], { caps: [view, unnamed], term: null })).toMatchObject({ unnamed: ['orders.delete'], untermed: ['orders'] });
    expect(report([list], { caps: [view, unnamed], term: null, folded: true })).toMatchObject({ unnamed: [], untermed: [] });
  });
});
