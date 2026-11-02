import { expect, test } from 'vitest';

import type { CellAgent } from '../../review/src/replay.ts';
import { ALERT_KINDS, alerts, queue } from '../src/alerts.ts';
import type { Capability, Cell } from '../src/cells.ts';
import type { MapEndpoint } from '../src/join.ts';
import { endpoint, who } from './fixtures.ts';

const cell = (capability: string, state: Cell['state'], decision: Cell['decision'] = null) => ({ capability, role: 'clerk', state, decision }) as Cell;
const finding = { state: 'valid', key: ['export', 'clerk'], decision: { verdict: 'finding', severity: 'high', reason: 'r' } } as unknown as Cell['decision'];
const name = ([c, r]: [string, string]) => `${c} for ${r}`;

const signalled = (method: string, path: string, n: number): MapEndpoint => ({
  ...endpoint(method, path, who('anyone')),
  signals: Array.from({ length: n }, () => ({ id: 'open_write' as const, text: '' })),
});
const list = signalled('GET', '/orders/', 0);
const stray = signalled('POST', '/stray/', 2);
const exported = signalled('GET', '/orders/export/', 1);
const exportCap = { id: 'export' } as Capability;

test('only what the map raises, in order: undecided, finding, open', () => {
  const out = alerts([cell('open', 'open'), cell('export', 'pass', finding), cell('partial', 'partial')], name);
  expect(ALERT_KINDS).toEqual(['undecided', 'finding', 'open']);
  expect(out.map(a => [a.kind, a.cell])).toEqual([
    ['undecided', ['partial', 'clerk']],
    ['finding', ['export', 'clerk']],
    ['open', ['open', 'clerk']],
  ]);
});

test('an endpoint with a signal and no capability is in the queue once and in no alert', () => {
  const agents = [
    { key: ['export', 'clerk'], event: { event: 'signal_raised' } },
    { key: ['export', 'manager'], event: { event: 'triaged' } },
  ] as unknown as CellAgent[];
  const q = queue([list, stray, exported], agents, [{ cap: exportCap, found: [exported] }]);
  expect(q).toEqual({ signals: 4, endpoints: [stray.key, exported.key] });
  expect(alerts([cell('export', 'partial')], name).every(a => !('endpoint' in a))).toBe(true);
});

test('no signal and no open agent signal leaves the queue empty', () => {
  expect(queue([list], [], [])).toEqual({ signals: 0, endpoints: [] });
});
