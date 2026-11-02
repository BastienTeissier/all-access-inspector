import { expect, test } from 'vitest';

import type { CellAgent } from '../../review/src/replay.ts';
import { ALERT_KINDS, alerts, queue } from '../src/alerts.ts';
import type { Cell } from '../src/cells.ts';
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

test('only what the map raises, in order: undecided, finding, open', () => {
  const out = alerts([cell('open', 'open'), cell('export', 'pass', finding), cell('partial', 'partial')], name);
  expect(ALERT_KINDS).toEqual(['undecided', 'finding', 'open']);
  expect(out.map(a => [a.kind, a.cell])).toEqual([
    ['undecided', ['partial', 'clerk']],
    ['finding', ['export', 'clerk']],
    ['open', ['open', 'clerk']],
  ]);
});

test('endpoint signals and an open agent signal are counted on the queue', () => {
  const agents = [
    { key: ['export', 'clerk'], event: { event: 'signal_raised' } },
    { key: ['export', 'manager'], event: { event: 'triaged' } },
  ] as unknown as CellAgent[];
  expect(queue([list, stray, exported], agents)).toEqual({ signals: 4 });
});

test('no signal and no open agent signal leaves the queue empty', () => {
  expect(queue([list], [])).toEqual({ signals: 0 });
});
