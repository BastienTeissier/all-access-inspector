// The projection against the review package: same queue as `review status --json`, a cache that can be deleted, the last
// good state kept when a file breaks.

import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, expect, test } from 'vitest';

import { keyText } from '../../../skills/all-access-inspector/review/src/inventory.ts';
import { load } from '../../../skills/all-access-inspector/review/src/project.ts';
import { queue as reviewQueue } from '../../../skills/all-access-inspector/review/src/tiers.ts';
import { cachePath, header, history, project, queue, row } from '../lib/projection.ts';

const REPO = join(import.meta.dirname, '..', '..', '..');
const INVENTORY = join(REPO, 'fixtures', 'django-demo', 'expected', 'inventory.json');
const SAMPLE_LOG = join(REPO, 'skills', 'all-access-inspector', 'review', 'tests', 'samples', 'django-demo.reviews.jsonl');

let dir: string;
const tools = (file: string) => join(dir, 'tools', 'access-inspector', file);

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'projection-'));
  process.env.HOME = join(root, 'home');
  dir = join(root, 'django-demo');
  mkdirSync(join(dir, 'tools', 'access-inspector'), { recursive: true });
  copyFileSync(INVENTORY, tools('inventory.json'));
  copyFileSync(SAMPLE_LOG, tools('reviews.jsonl'));
});

const keys = (rows: { key: [string, string, string]; tier: number }[]) => rows.map(r => [keyText(r.key), r.tier]);

test('the queue is the review package queue, in the same order', () => {
  const { db, error } = project(dir);
  expect(error).toBeNull();
  expect(keys(queue(db!, {}))).toEqual(keys(reviewQueue(load(dir).rows)));
  expect(header(db!)).toMatchObject({ stack: 'django', dimensions: true, orphaned: 1 });
});

test('filters narrow the queue; the reviewed view lists valid Verdicts', () => {
  const { db } = project(dir);
  const all = queue(db!, {});
  const only = (filtered: typeof all, keep: (r: (typeof all)[number]) => boolean) => {
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered).toEqual(all.filter(keep));
  };
  only(queue(db!, { tier: '8' }), r => r.tier === 8);
  only(queue(db!, { signal: 'open_write' }), r => r.signals.some(s => s.id === 'open_write'));
  only(queue(db!, { zone: 'access_tier=staff' }), r => r.dimensions.access_tier === 'staff');
  only(queue(db!, { q: '/pages/' }), r => r.path.includes('/pages/'));
  only(queue(db!, { state: 'outdated' }), r => r.state === 'outdated');
  const reviewed = queue(db!, { view: 'reviewed' });
  expect(reviewed.length).toBeGreaterThan(0);
  expect(reviewed.every(r => r.state === 'valid')).toBe(true);
});

test('a row carries its siblings and its history, newest first', () => {
  // give POST /pages/stock/ an access its GET does not have: they become siblings
  const inventory = JSON.parse(readFileSync(INVENTORY, 'utf8')) as { endpoints: { method: string; path: string; authentication: object }[] };
  const post = inventory.endpoints.find(e => e.method === 'POST' && e.path === '/pages/stock/')!;
  post.authentication = { ...post.authentication, value: 'anonymous', rule: 'test:anonymous' };
  writeFileSync(tools('inventory.json'), JSON.stringify(inventory));
  const { db } = project(dir);
  const all = queue(db!, {});
  expect(all.find(r => r.method === 'POST' && r.path === '/pages/stock/')!.siblings).toContainEqual(['GET', '/pages/stock/', 'shop/views.py']);
  const refund = all.find(r => r.path === '/api/orders/{pk}/refund/')!;
  expect(history(db!, keyText(refund.key))[0]).toMatchObject({ event: 'signal_raised' });
  expect(row(db!, keyText(refund.key))?.path).toBe(refund.path);
});

test('an outside change is picked up, and deleting the cache loses nothing', () => {
  const before = keys(queue(project(dir).db!, {}));
  rmSync(cachePath(dir));
  expect(keys(queue(project(dir).db!, {}))).toEqual(before);
  writeFileSync(tools('reviews.jsonl'), '');
  expect(queue(project(dir).db!, {}).length).toBeGreaterThan(before.length);
});

test('a broken log is named and the last good state stays', () => {
  const before = keys(queue(project(dir).db!, {}));
  appendFileSync(tools('reviews.jsonl'), 'not json\n');
  const broken = project(dir);
  expect(broken.error).toMatch(/reviews\.jsonl line \d+: not valid JSON/);
  expect(keys(queue(broken.db!, {}))).toEqual(before);
});
