import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Axis, type Endpoint, type Inventory, fromJson } from '../access_inspector/inventory.js';

export const SAMPLES = join(import.meta.dirname, '..', '..', '..', 'schema', 'samples');

export const load = (name: string): Inventory => fromJson(readFileSync(join(SAMPLES, name), 'utf8'));

export const endpoint = (method: string, path: string, handler = 'ShopController.list'): Endpoint => {
  const axis: Axis = { value: 'anonymous', layer: 'framework-default', raw: null, rule: 'builtin:no_check', evidence: null };
  return {
    method,
    path,
    handler,
    authentication: axis,
    authorization: { ...axis, value: 'none' },
    dimensions: { access_tier: 'public' },
    unknown_reason: null,
    acknowledged: false,
  };
};
