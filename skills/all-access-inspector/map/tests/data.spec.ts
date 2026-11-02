import { expect, test } from 'vitest';

import { capabilityList } from '../src/cells.ts';
import { areaList } from '../src/data.ts';
import { isFirstParty } from '../src/join.ts';
import { runtime, vocabulary } from './fixtures.ts';

const rt = runtime({
  areas: [
    { id: 'shop.order', name: 'orders', at: 'shop/models.py:8' },
    { id: 'shop.product', name: 'products', at: 'shop/models.py:4' },
  ],
  capabilities: [
    { id: 'shop.order.view', area: 'shop.order', term: 'Order', verb: 'read', endpoints: [], check: 'c', at: 'a.py:1', basis: 'extracted' },
    { id: 'shop.product.view', area: 'shop.product', term: 'Product', verb: 'read', endpoints: [], check: 'c', at: 'a.py:2', basis: 'extracted' },
  ],
});

test('an area takes the vocabulary name and term first, else the runtime name and at, and the extracted term', () => {
  const v = vocabulary({ areas: [{ id: 'shop.order', name: 'Orders', term: 'Purchase' }] });
  expect(areaList(v, rt, capabilityList(rt, v)).map(({ id, name, term, defined_at }) => [id, name, term, defined_at])).toEqual([
    ['shop.order', 'Orders', 'Purchase', 'shop/models.py:8'],
    ['shop.product', 'products', 'Product', 'shop/models.py:4'],
  ]);
});

test('an area the runtime does not name keeps its id', () => {
  const bare = runtime({ capabilities: rt.capabilities });
  expect(areaList(vocabulary(), bare, capabilityList(bare, vocabulary())).map(a => [a.name, a.defined_at])).toEqual([
    ['shop.order', null],
    ['shop.product', null],
  ]);
});

test('a first-party handler has a file:line, or on nestjs and spring sits outside the framework', () => {
  expect(isFirstParty('shop/views.py:12', 'django')).toBe(true);
  expect(isFirstParty('allauth.account.views.LoginView', 'django')).toBe(false);
  expect(isFirstParty('AdminController.list', 'nestjs')).toBe(true);
  expect(isFirstParty('org.springframework.boot.autoconfigure.web.servlet.error.BasicErrorController.error', 'spring')).toBe(false);
});
