// status --json: the interface Triage reads.

import { copyFileSync, readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { GOLDEN, SAMPLE_LOG, project, review, tools, useProject } from './project.ts';

useProject();

interface JsonRow {
  method: string;
  path: string;
  tier: number;
  verdict: object | null;
  agent: { event: string } | null;
  triage: boolean;
}

const status = () => review(['status', project, '--json']).stdout.trimEnd().split('\n').map(l => JSON.parse(l) as JsonRow);

test('status --json prints one row per queued endpoint, in queue order', () => {
  copyFileSync(SAMPLE_LOG, tools('reviews.jsonl'));
  const rows = status();
  const text = readFileSync(GOLDEN, 'utf8');
  expect(rows).toHaveLength(Number(/Review Queue: (\d+) rows/.exec(text)![1]));
  expect(rows[0]).toMatchObject({ method: 'ANY', path: '/pages/v1/old/', tier: 1, verdict: { verdict: 'finding', severity: 'high' } });
  expect(Object.keys(rows[0]!)).toEqual(['key', 'method', 'head', 'path', 'handler', 'authentication', 'authorization', 'dimensions', 'unknown_reason', 'inside', 'state', 'moot', 'verdict', 'agent', 'signals', 'tier', 'triage']);
  expect(Object.keys(rows[0]!.verdict!)).not.toContain('seen');
  // Triage reads `agent` to skip what it already read for the current classification
  const agents = rows.flatMap(r => (r.agent ? [[r.path, r.agent.event]] : []));
  expect(agents).toEqual([
    ['/api/orders/{pk}/refund/', 'signal_raised'],
    ['/api/invoices/', 'triaged'],
  ]);
  const listed = text.split('\n').filter(l => l.startsWith('  ') && !text.slice(text.indexOf('Orphaned')).includes(l));
  expect(rows.map(r => r.path)).toEqual(listed.map(l => l.trim().split(/\s+/)[1]));
});

test('triage leaves out what a human ruled on, what a rule decides, and what the Agent already read', () => {
  copyFileSync(SAMPLE_LOG, tools('reviews.jsonl'));
  const before = status();
  const scope = before.filter(r => r.triage).map(r => `${r.method} ${r.path}`);
  expect(scope).toContain('ANY /health/');
  expect(before.find(r => r.path === '/pages/v1/old/')).toMatchObject({ state: 'valid', triage: false });
  expect(before.filter(r => r.tier === 11).every(r => !r.triage)).toBe(true);
  expect(before.filter(r => r.agent).every(r => !r.triage)).toBe(true);
  const read = [
    { event: 'triaged', method: 'ANY', path: '/health/' },
    { event: 'triaged', method: 'ANY', path: '/pages/v1/old/' },
  ];
  expect(review(['append', project, '--agent', '--model', 'claude-test'], { input: read.map(e => JSON.stringify(e)).join('\n') }).status).toBe(0);
  const after = status();
  expect(after.find(r => r.path === '/health/')).toMatchObject({ agent: { event: 'triaged' }, triage: false });
  expect(after.find(r => r.path === '/pages/v1/old/')).toMatchObject({ triage: false });
  expect(after.filter(r => r.triage).map(r => `${r.method} ${r.path}`)).toEqual(scope.filter(k => k !== 'ANY /health/'));
});
