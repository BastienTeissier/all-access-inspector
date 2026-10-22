import { expect, test } from 'vitest';

import { type Assign, MissingDimension, assign } from '../access_inspector/dimensions.js';
import { endpoint } from './samples.js';

const DIMENSIONS = { access_tier: ['public', 'customer', 'staff'] };
const RULES: Assign[] = [
  { dimension: 'access_tier', value: 'staff', when: e => e.path.startsWith('/api/admin/') },
  { dimension: 'access_tier', value: 'customer', when: e => e.path.startsWith('/api/') },
];

test('first rule wins', () => {
  expect(assign(endpoint('GET', '/api/admin/users/'), DIMENSIONS, RULES)).toEqual({ access_tier: 'staff' });
  expect(assign(endpoint('GET', '/api/orders/'), DIMENSIONS, RULES)).toEqual({ access_tier: 'customer' });
});

test('missing', () => {
  expect(() => assign(endpoint('GET', '/about/'), DIMENSIONS, RULES)).toThrow(
    new MissingDimension("GET /about/ (ShopController.list): no rule assigns dimension 'access_tier'"),
  );
});

test('none declared', () => expect(assign(endpoint('GET', '/about/'), {}, [])).toEqual({}));
