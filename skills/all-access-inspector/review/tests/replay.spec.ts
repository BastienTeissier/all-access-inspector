import { describe, expect, test } from 'vitest';

import { replay } from '../src/replay.ts';
import { queue } from '../src/tiers.ts';
import { agentEvent, axis, endpoint, inventory, reviewed } from './build.ts';

const TODAY = '2026-10-15';

const only = (endpoints: ReturnType<typeof endpoint>[], events: Parameters<typeof replay>[1]) => replay(inventory(endpoints), events, TODAY);

describe('latest Verdict wins', () => {
  test('by date, then by line', () => {
    const e = endpoint('GET', '/a');
    const early = reviewed(e, { at: '2026-09-02T10:00:00Z', verdict: 'finding', severity: 'low' });
    const late = reviewed(e, { at: '2026-09-01T10:00:00Z' });
    expect(only([e], [early, late]).rows[0]!.verdict).toBe(early);
    const second = reviewed(e, { at: early.at, verdict: 'accepted' });
    expect(only([e], [early, second]).rows[0]!.verdict).toBe(second);
  });
});

describe('outdated', () => {
  test('inside: a value change outdates, a raw change alone does not', () => {
    const before = endpoint('GET', '/a', 'required', 'none', { dimensions: { zone: 'other' } });
    const verdict = reviewed(before);
    expect(only([endpoint('GET', '/a', 'required', 'rule', { dimensions: { zone: 'other' } })], [verdict]).rows[0]!.state).toBe('outdated');
    const raw = { ...before, authentication: axis('required', { raw: 'LoginRequiredMixin' }) };
    expect(only([raw], [verdict]).rows[0]!.state).toBe('valid');
  });

  test('outside: any change to the check outdates, evidence or handler line do not', () => {
    const before = endpoint('GET', '/a', 'required', 'none', { authorization: axis('none', { raw: 'A' }) });
    const verdict = reviewed(before);
    expect(verdict.seen.inside).toBe(false);
    expect(only([{ ...before, authorization: axis('none', { raw: 'B' }) }], [verdict]).rows[0]!.state).toBe('outdated');
    const moved = { ...before, handler: 'app/views.py:40', authorization: axis('none', { raw: 'A', evidence: 'app/views.py:41' }) };
    expect(only([moved], [verdict]).rows[0]!.state).toBe('valid');
  });

  test('accepted until yesterday is outdated, until today is valid', () => {
    const e = endpoint('GET', '/a');
    expect(only([e], [reviewed(e, { verdict: 'accepted', until: '2026-10-14' })]).rows[0]!.state).toBe('outdated');
    expect(only([e], [reviewed(e, { verdict: 'accepted', until: TODAY })]).rows[0]!.state).toBe('valid');
  });
});

test('moot: reviewed outside, inside now, is still valid', () => {
  const e = endpoint('GET', '/a');
  const verdict = reviewed(e);
  verdict.seen.inside = false;
  const row = only([e], [verdict]).rows[0]!;
  expect([row.state, row.moot]).toEqual(['valid', true]);
});

test('orphan: a key no endpoint has any more', () => {
  const gone = endpoint('GET', '/a');
  const moved = { ...gone, handler: 'app/other.py:10' };
  const { rows, orphans } = only([moved], [reviewed(gone)]);
  expect(orphans.map(o => o.key)).toEqual([['GET', '/a', 'app/views.py']]);
  expect(rows.map(r => [r.key, r.state])).toEqual([[['GET', '/a', 'app/other.py'], 'none']]);
  expect(queue(rows)).toHaveLength(1);
});

test('a Verdict on a folded HEAD is not an orphan', () => {
  const get = endpoint('GET', '/a');
  const head = endpoint('HEAD', '/a');
  expect(only([get, head], [reviewed(get), reviewed(head)]).orphans).toEqual([]);
});

describe('agent events', () => {
  test('a signal ranks the row at tier 7 with an agent Signal', () => {
    const e = endpoint('POST', '/a');
    const row = only([e], [agentEvent(e, 'signal_raised')]).rows[0]!;
    expect([row.tier, row.signals.map(s => s.id)]).toEqual([7, ['agent']]);
  });

  test('dropped when the endpoint changed since', () => {
    const e = endpoint('POST', '/a', 'required', 'rule', { dimensions: { zone: 'other' } });
    const row = only([{ ...e, authorization: axis('none') }], [agentEvent(e, 'signal_raised')]).rows[0]!;
    expect([row.agent, row.signals.map(s => s.id)]).toEqual([null, []]);
  });

  test('a valid human Verdict supersedes it', () => {
    const e = endpoint('POST', '/a');
    const row = only([e], [agentEvent(e, 'signal_raised'), reviewed(e)]).rows[0]!;
    expect(row.agent).toBeNull();
  });

  test('triaged raises nothing', () => {
    const e = endpoint('POST', '/a');
    const row = only([e], [agentEvent(e, 'triaged')]).rows[0]!;
    expect([row.agent?.event, row.signals, row.tier]).toEqual(['triaged', [], 11]);
  });
});

describe('sibling', () => {
  test('list and detail of one resource with different access name each other', () => {
    const list = endpoint('POST', '/observations/', 'required', 'rule', { handler: 'app/a.py:1' });
    const detail = endpoint('PUT', '/observations/{id}/', 'required', 'none', { handler: 'app/b.py:1', dimensions: { zone: 'other' } });
    const [a, b] = only([list, detail], []).rows;
    expect(a!.signals[0]).toEqual({ id: 'sibling', text: 'PUT /observations/{id}/ is required/none' });
    expect(b!.signals[0]).toEqual({ id: 'sibling', text: 'POST /observations/ is required/rule' });
  });

  test('a parent ending in a parameter is related to its child, two peer parameter paths are not', () => {
    const zone = { dimensions: { zone: 'other' } };
    const rows = only(
      [
        endpoint('GET', '/r/{ct}/', 'required', 'rule', { ...zone, handler: 'app/a.py:1' }),
        endpoint('GET', '/r/{ct}/{obj}/', 'required', 'none', { ...zone, handler: 'app/b.py:1' }),
        endpoint('GET', '/files/{id}', 'required', 'rule', { ...zone, handler: 'app/c.py:1' }),
        endpoint('GET', '/files/{name}/', 'required', 'none', { ...zone, handler: 'app/d.py:1' }),
      ],
      [],
    ).rows;
    expect(Object.fromEntries(rows.map(r => [r.path, r.signals[0]?.text ?? null]))).toEqual({
      '/r/{ct}/': 'GET /r/{ct}/{obj}/ is required/none',
      '/r/{ct}/{obj}/': 'GET /r/{ct}/ is required/rule',
      '/files/{id}': null,
      '/files/{name}/': 'path parameter, no authorization rule',
    });
  });

  test('two methods of one path with different access are siblings', () => {
    const zone = { dimensions: { zone: 'other' }, handler: 'django.contrib.admin.sites.index' };
    const rows = only([endpoint('ANY', '/admin/', 'required', 'rule', zone), endpoint('DELETE', '/admin/', 'anonymous', 'none', zone)], []).rows;
    expect(rows.map(r => r.signals[0]?.id)).toEqual(['sibling', 'sibling']);
  });

  test('one rule splitting by method is not a sibling inconsistency', () => {
    const rule = { rule: 'builtin:IsAuthenticatedOrReadOnly' };
    const get = endpoint('GET', '/a', 'optional', 'none', { dimensions: { zone: 'other' } });
    const post = endpoint('POST', '/a', 'required', 'none', { dimensions: { zone: 'other' } });
    const rows = only(
      [
        { ...get, authentication: axis('optional', rule), authorization: axis('none', rule) },
        { ...post, authentication: axis('required', rule), authorization: axis('none', rule) },
      ],
      [],
    ).rows;
    expect(rows.flatMap(r => r.signals.map(s => s.id))).not.toContain('sibling');
  });

  test('a framework handler shared by unrelated paths and OPTIONS rows are not compared', () => {
    const redirect = { handler: 'django.views.generic.base.RedirectView', dimensions: { zone: 'other' } };
    const rows = only(
      [
        endpoint('GET', '/', 'anonymous', 'none', redirect),
        endpoint('GET', '/admin/x/', 'required', 'rule', redirect),
        endpoint('GET', '/api/', 'required', 'rule', { dimensions: { zone: 'other' } }),
        endpoint('OPTIONS', '/api/', 'required', 'none', { dimensions: { zone: 'other' } }),
      ],
      [],
    ).rows;
    expect(rows.flatMap(r => r.signals.map(s => s.id))).not.toContain('sibling');
  });
});
