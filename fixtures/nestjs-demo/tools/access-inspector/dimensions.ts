// Project Dimensions: the project's own labels, assigned to every endpoint by ordered rules.

import { type Endpoint, type ExpectedAccess, label } from './inventory.js';

export interface Assign {
  dimension: string;
  value: string;
  when: (endpoint: Endpoint) => boolean;
}

export class MissingDimension extends Error {}

// --- project ---
// Declared values, in order, e.g. { access_tier: ['public', 'customer', 'staff'] }.
export const DIMENSIONS: Record<string, string[]> = { access_tier: ['public', 'customer', 'partner', 'staff'] };

// What each value should allow, as the team confirmed it; a value left out is not checked, e.g.
// { access_tier: { staff: { authentication: ['required'], authorization: ['rule'] } } }.
export const EXPECTED: ExpectedAccess = {
  access_tier: {
    public: { authentication: ['anonymous', 'optional'], authorization: ['none'] },
    customer: { authentication: ['required'], authorization: ['none', 'rule'] },
    partner: { authentication: ['required'], authorization: ['none', 'rule'] },
    staff: { authentication: ['required'], authorization: ['rule'] },
  },
};

// Most specific first; the first matching rule of a dimension wins, e.g.:
// { dimension: 'access_tier', value: 'staff', when: e => e.path.startsWith('/admin/') },
export const RULES: Assign[] = [
  { dimension: 'access_tier', value: 'staff', when: e => e.path.startsWith('/api/admin/') },
  { dimension: 'access_tier', value: 'partner', when: e => e.path.startsWith('/api/partner/') },
  { dimension: 'access_tier', value: 'customer', when: e => e.path.startsWith('/api/v1/account/') },
  { dimension: 'access_tier', value: 'public', when: () => true },
];
// --- end project ---

/** One value per declared dimension; an endpoint no rule covers is a failure, never a null. */
export const assign = (
  endpoint: Endpoint,
  dimensions: Record<string, string[]> = DIMENSIONS,
  rules: Assign[] = RULES,
): Record<string, string> =>
  Object.fromEntries(
    Object.keys(dimensions).map(dimension => {
      const rule = rules.find(r => r.dimension === dimension && r.when(endpoint));
      if (rule === undefined) {
        throw new MissingDimension(`${label(endpoint)}: no rule assigns dimension '${dimension}'`);
      }
      return [dimension, rule.value];
    }),
  );
