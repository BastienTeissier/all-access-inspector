// History's grouping: one group per batch, a single Verdict alone, newest first.

import { expect, test } from 'vitest';

import { parseLog } from '../../../skills/all-access-inspector/review/src/log.ts';
import { candidates, groups, kinds, reason } from '../lib/history.ts';

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
