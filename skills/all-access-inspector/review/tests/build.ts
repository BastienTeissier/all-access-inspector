// Inventories and events built in the tests: only what a case changes is spelled out.

import { type Axis, type Endpoint, type ExpectedAccess, type Inventory, keyOf, seenOf } from '../src/inventory.ts';
import type { Event, Logged, Reviewed } from '../src/log.ts';

export const axis = (value: string, extra: Partial<Axis> = {}): Axis => ({
  value,
  layer: value === 'unknown' ? null : 'global',
  raw: null,
  rule: value === 'unknown' ? null : `builtin:${value}`,
  evidence: null,
  ...extra,
});

export const endpoint = (
  method: string,
  path: string,
  authentication = 'required',
  authorization = 'rule',
  extra: Partial<Endpoint> = {},
): Endpoint => ({
  method,
  path,
  handler: 'app/views.py:10',
  authentication: axis(authentication),
  authorization: axis(authorization),
  dimensions: { zone: 'user' },
  unknown_reason: null,
  acknowledged: false,
  ...extra,
});

/** user expects required + rule; public expects anonymous or optional, none. */
export const EXPECTED: ExpectedAccess = {
  zone: {
    user: { authentication: ['required'], authorization: ['rule'] },
    public: { authentication: ['anonymous', 'optional'], authorization: ['none'] },
  },
};

export const inventory = (endpoints: Endpoint[], expected: ExpectedAccess = EXPECTED): Inventory => ({
  schema_version: '1',
  stack: 'django',
  coverage: 'complete',
  expected_access: expected,
  endpoints,
});

let line = 0;

/** A Verdict on `e` as it is now, unless `seen` says otherwise. */
export const reviewed = (e: Endpoint, extra: Partial<Reviewed> = {}, expected: ExpectedAccess = EXPECTED): Reviewed & Logged => ({
  v: 1,
  at: '2026-09-01T10:00:00Z',
  by: 'reviewer@example.com',
  event: 'reviewed',
  batch: null,
  endpoint: keyOf(e),
  seen: seenOf(e, expected),
  verdict: 'safe',
  reason: 'checked',
  ...extra,
  line: ++line,
});

export const agentEvent = (e: Endpoint, event: 'signal_raised' | 'triaged', at = '2026-09-02T10:00:00Z'): Event & Logged =>
  ({
    v: 1,
    at,
    by: 'agent:test',
    event,
    batch: 'b-00000000',
    endpoint: keyOf(e),
    seen: seenOf(e, EXPECTED),
    ...(event === 'signal_raised' ? { reason: 'looks odd', evidence: 'app/views.py:12' } : {}),
    line: ++line,
  }) as Event & Logged;
