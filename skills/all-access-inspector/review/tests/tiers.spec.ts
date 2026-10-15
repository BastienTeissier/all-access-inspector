import { expect, test } from 'vitest';

import { type Endpoint } from '../src/inventory.ts';
import type { Logged } from '../src/log.ts';
import { replay } from '../src/replay.ts';
import { queue, tierOf } from '../src/tiers.ts';
import { agentEvent, axis, endpoint as built, inventory, reviewed } from './build.ts';

const other = { dimensions: { zone: 'other' } };

/** One handler per path, so only the rows a case pairs on purpose are siblings. */
const endpoint = (...args: Parameters<typeof built>): Endpoint => {
  const e = built(...args);
  return args[4]?.handler ? e : { ...e, handler: `app${e.path}.py:1` };
};

test('one row per tier, each matching only that tier', () => {
  const finding = endpoint('GET', '/t01', 'required', 'rule', other);
  const outdated = endpoint('GET', '/t02', 'required', 'rule', other);
  const agent = endpoint('POST', '/t07', 'required', 'rule', other);
  const endpoints: Endpoint[] = [
    finding,
    outdated,
    endpoint('GET', '/t03', 'required', 'none'),
    endpoint('GET', '/t04', 'required', 'unknown', { ...other, authorization: axis('unknown') }),
    endpoint('GET', '/t05/', 'required', 'rule', { ...other, handler: 'app/a.py:1' }),
    endpoint('GET', '/t05/{id}/', 'required', 'none', { ...other, handler: 'app/b.py:1' }),
    endpoint('POST', '/t06', 'anonymous', 'none', other),
    agent,
    endpoint('GET', '/t08/{id}', 'required', 'none', other),
    endpoint('GET', '/t09', 'optional', 'none', other),
    endpoint('GET', '/t10', 'required', 'none', other),
    endpoint('GET', '/t11', 'required', 'rule', other),
  ];
  const events: Logged[] = [
    reviewed(finding, { verdict: 'finding', severity: 'high' }),
    reviewed({ ...outdated, authorization: axis('none') }),
    agentEvent(agent, 'signal_raised'),
  ];
  const tiers = Object.fromEntries(replay(inventory(endpoints), events, '2026-10-15').rows.map(r => [r.path, r.tier]));
  expect(tiers).toEqual({
    '/t01': 1,
    '/t02': 2,
    '/t03': 3,
    '/t04': 4,
    '/t05/': 5,
    '/t05/{id}/': 5,
    '/t06': 6,
    '/t07': 7,
    '/t08/{id}': 8,
    '/t09': 9,
    '/t10': 10,
    '/t11': 11,
  });
});

test('the highest tier wins, and ANY is a write', () => {
  const rows = replay(inventory([endpoint('ANY', '/x/{id}', 'anonymous', 'none', other)]), [], '2026-10-15').rows;
  expect(rows[0]!.signals.map(s => s.id)).toEqual(['open_write']);
  expect(rows[0]!.tier).toBe(6);
  const both = replay(inventory([endpoint('DELETE', '/x/{id}', 'required', 'none', other)]), [], '2026-10-15').rows;
  expect(both[0]!.tier).toBe(8);
});

test('valid safe and accepted leave the queue, a valid finding stays first; order is tier, path, method by code point', () => {
  const safe = endpoint('GET', '/a', 'required', 'rule', other);
  const accepted = endpoint('GET', '/b', 'required', 'rule', other);
  const finding = endpoint('GET', '/z', 'required', 'rule', other);
  const endpoints = [safe, accepted, finding, endpoint('POST', '/c'), endpoint('GET', '/c'), endpoint('GET', '/C'), endpoint('GET', '/d', 'required', 'none', other)];
  const events = [reviewed(safe), reviewed(accepted, { verdict: 'accepted' }), reviewed(finding, { verdict: 'finding', severity: 'low' })];
  const order = queue(replay(inventory(endpoints), events, '2026-10-15').rows).map(r => `${r.tier} ${r.method} ${r.path}`);
  expect(order).toEqual(['1 GET /z', '10 GET /d', '11 GET /C', '11 GET /c', '11 POST /c']);
});

test('the tier is the highest-ranked Signal, whatever the order they are listed in', () => {
  const row = { method: 'GET', path: '/a', authorization: { value: 'none' }, state: 'none' as const, verdict: null };
  const signals = [
    { id: 'open_read' as const, text: '' },
    { id: 'outside_expected' as const, text: '' },
  ];
  expect(tierOf({ ...row, signals })).toBe(3);
  expect(tierOf({ ...row, signals: signals.toReversed() })).toBe(3);
});
