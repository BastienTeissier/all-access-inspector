// appendBulk: the app's Review selection, written through the same checks and the same append as `review append`.

import { expect, test } from 'vitest';

import { appendBulk } from '../src/append.ts';
import type { Key } from '../src/inventory.ts';
import { Refused, load } from '../src/project.ts';
import { events, gitconfig, log, project, useProject } from './project.ts';

useProject();

const bulk = (keys: Key[], values: Record<string, string> = { verdict: 'safe', reason: 'one rule guards them all' }) => {
  process.env.GIT_CONFIG_GLOBAL = gitconfig;
  return appendBulk(project, values, keys);
};

test('one event per selected endpoint, its folded HEAD too, all in one batch, none naming a selector', () => {
  const rows = load(project).rows;
  const picked = [rows.find(r => r.head)!, rows.find(r => !r.head && r.method === 'POST')!];
  const { events: count, batch } = bulk(picked.map(r => r.key));
  const written = events();
  expect(count).toBe(3);
  expect(written.map(e => e.endpoint)).toEqual([picked[0]!.key, ['HEAD', picked[0]!.path, picked[0]!.key[2]], picked[1]!.key]);
  expect(new Set(written.map(e => e.batch))).toEqual(new Set([batch]));
  expect(batch).toMatch(/^b-[0-9a-f]{8}$/);
  expect(written.every(e => e.event === 'reviewed' && e.verdict === 'safe' && e.by === 'reviewer@example.com')).toBe(true);
});

test('an empty selection, a key no longer in the inventory or a finding without severity writes nothing', () => {
  const [row] = load(project).rows;
  expect(() => bulk([])).toThrow(new Refused('the selection is empty'));
  expect(() => bulk([row!.key, ['GET', '/gone/', 'shop/views.py']])).toThrow(/GET \/gone\/ is no longer in the inventory/);
  expect(() => bulk([row!.key], { verdict: 'finding', reason: 'all open' })).toThrow(/a finding needs a severity/);
  expect(log()).toBe('');
});
