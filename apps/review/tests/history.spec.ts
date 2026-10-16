// History's grouping: one group per batch, a single Verdict alone, newest first.

import { expect, test } from 'vitest';

import { parseLog } from '../../../skills/all-access-inspector/review/src/log.ts';
import { PAGE, candidates, endpoints, groups, kinds, page, reason } from '../lib/history.ts';

const line = (at: string, batch: string | null, event: string, extra: Record<string, string>) =>
  JSON.stringify({
    v: 1,
    at,
    by: batch ? 'agent:m' : 'r@example.com',
    event,
    batch,
    endpoint: ['GET', `/${at}`, 'a.py'],
    seen: {
      handler: 'a.py:1',
      authentication: { value: 'required', layer: null, raw: null, rule: null },
      authorization: { value: 'none', layer: null, raw: null, rule: null },
      inside: null,
    },
    ...extra,
  });

test('a batch is one group however its events interleave, a single event is its own, newest first', () => {
  const { events, errors } = parseLog(
    [
      line('2026-01-01T00:00:00Z', null, 'reviewed', { verdict: 'safe', reason: 'old' }),
      line('2026-01-02T00:00:00Z', 'b-00000001', 'triaged', {}),
      line('2026-01-02T00:00:01Z', 'b-00000001', 'signal_raised', { reason: 'no check', evidence: 'a.py:3' }),
      line('2026-01-02T00:00:02Z', 'b-00000001', 'triaged', {}),
    ].join('\n'),
  );
  expect(errors).toEqual([]);
  const newestFirst = [...events].reverse();
  const [agent, single] = groups(newestFirst);
  expect(groups(newestFirst)).toHaveLength(2);
  expect([agent!.batch, agent!.at, agent!.events.length, kinds(agent!)]).toEqual(['b-00000001', '2026-01-02T00:00:02Z', 3, 'triaged ×2 · signal_raised']);
  expect(reason(agent!)).toBeNull();
  expect([single!.batch, kinds(single!), reason(single!)]).toEqual([null, 'safe', 'old']);
});

test('an orphan is proposed to an unreviewed endpoint on its path or in its project file, never by a framework handler', () => {
  const orphan = (path: string, handler: string) =>
    ({ key: ['GET', path, handler.replace(/:\d+$/, '')], verdict: { seen: { handler }, reason: path } }) as never;
  const row = (path: string, handler: string, state = 'none') => ({ path, handler, state }) as never;
  const lost = [orphan('/a/', 'shop/api.py:3'), orphan('/b/', 'shop/views.py:9'), orphan('/c/', 'django.views.RedirectView')];
  const reasons = (r: never) => candidates(r, lost).map(o => o.verdict.reason);
  expect(reasons(row('/x/', 'shop/api.py:40'))).toEqual(['/a/']);
  expect(reasons(row('/b/', 'django.views.RedirectView'))).toEqual(['/b/']);
  expect(reasons(row('/y/', 'django.views.RedirectView'))).toEqual([]);
  expect(reasons(row('/a/', 'shop/api.py:40', 'valid'))).toEqual([]);
});

test('a HEAD reviewed with its GET is counted with it, a HEAD alone or of another handler on its own', () => {
  const event = (method: string, path: string, handler: string) => ({ event: 'reviewed', verdict: 'safe', endpoint: [method, path, handler] }) as never;
  const group = {
    batch: 'b-1',
    by: 'r@example.com',
    at: '2026-01-01T00:00:00Z',
    events: [event('GET', '/a/', 'a.py'), event('HEAD', '/a/', 'a.py'), event('HEAD', '/b/', 'a.py'), event('HEAD', '/a/', 'b.py')],
  };
  expect(endpoints(group).map(e => (e as { endpoint: string[] }).endpoint)).toEqual([
    ['GET', '/a/', 'a.py'],
    ['HEAD', '/b/', 'a.py'],
    ['HEAD', '/a/', 'b.py'],
  ]);
  expect(kinds(group)).toBe('safe ×3');
});

test('History shows the newest groups a page at a time, a page that is not a number as the first', () => {
  const all = Array.from({ length: PAGE + 3 }, (_, i) => ({ batch: `b-${i}`, by: 'r@example.com', at: '', events: [] }));
  expect(page(all, null)).toMatchObject({ n: 0, older: true });
  expect(page(all, null).groups.map(g => g.batch)).toEqual(all.slice(0, PAGE).map(g => g.batch));
  expect(page(all, '1')).toMatchObject({ n: 1, older: false, groups: all.slice(PAGE) });
  expect(page(all, '-1').n).toBe(0);
  expect(page(all, 'x').n).toBe(0);
});
