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
}

test('status --json prints one row per queued endpoint, in queue order', () => {
  copyFileSync(SAMPLE_LOG, tools('reviews.jsonl'));
  const rows = review(['status', project, '--json']).stdout.trimEnd().split('\n').map(l => JSON.parse(l) as JsonRow);
  const text = readFileSync(GOLDEN, 'utf8');
  expect(rows).toHaveLength(Number(/Review Queue: (\d+) rows/.exec(text)![1]));
  expect(rows[0]).toMatchObject({ method: 'ANY', path: '/pages/v1/old/', tier: 1, verdict: { verdict: 'finding', severity: 'high' } });
  expect(Object.keys(rows[0]!)).toEqual(['key', 'method', 'head', 'path', 'handler', 'authentication', 'authorization', 'dimensions', 'unknown_reason', 'inside', 'state', 'moot', 'verdict', 'agent', 'signals', 'tier']);
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
