// The review CLI run as a user runs it, inside a temporary project holding the django-demo inventory.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { GOLDEN, INVENTORY, SAMPLE_LOG, events, git, gitconfig, log, project, review, tools, useProject } from './project.ts';

useProject();

test('status prints the golden queue, the same from any cwd', () => {
  copyFileSync(SAMPLE_LOG, tools('reviews.jsonl'));
  const first = review(['status', project]);
  expect(first.status).toBe(0);
  expect(first.stdout).toBe(readFileSync(GOLDEN, 'utf8'));
  expect(review(['status', '.']).stdout).toBe(first.stdout);
  expect(review(['status', project], { cwd: tmpdir() }).stdout).toBe(first.stdout);
});

test('status without an inventory asks for a fit', () => {
  const result = review(['status', mkdtempSync(join(tmpdir(), 'empty-'))]);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('fit the project first');
});

test('status names a broken log line', () => {
  const [first] = readFileSync(SAMPLE_LOG, 'utf8').split('\n');
  writeFileSync(tools('reviews.jsonl'), `${first}\n<<<<<<< HEAD\n`);
  const result = review(['status', project]);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('reviews.jsonl line 2');
});

test('append a Verdict: one line per endpoint, the folded HEAD too, the union merge attribute created', () => {
  copyFileSync(SAMPLE_LOG, tools('reviews.jsonl'));
  const before = log();
  const result = review(['append', project, '--verdict', 'safe', '--reason', 'r', 'GET', '/api/invoices/']);
  expect(result).toMatchObject({ status: 0, stdout: 'appended 2 events: safe GET /api/invoices/\n' });
  expect(log().startsWith(before)).toBe(true);
  const added = events().slice(-2);
  expect(added.map(e => (e.endpoint as string[])[0])).toEqual(['GET', 'HEAD']);
  expect(added.every(e => e.by === 'reviewer@example.com' && e.batch === null && e.verdict === 'safe')).toBe(true);
  expect(readFileSync(tools('.gitattributes'), 'utf8')).toBe('reviews.jsonl merge=union\n');
});

test('append adds the union merge attribute to an existing .gitattributes, once', () => {
  writeFileSync(tools('.gitattributes'), '*.json text');
  const args = ['append', project, '--verdict', 'safe', '--reason', 'r', 'DELETE', '/api/invoices/{pk}/'];
  review(args);
  review(args);
  expect(readFileSync(tools('.gitattributes'), 'utf8')).toBe('*.json text\nreviews.jsonl merge=union\n');
});

test.each([
  ['an unknown path', ['--verdict', 'safe', '--reason', 'r', 'GET', '/nowhere/'], 'no endpoint GET /nowhere/'],
  ['no reason', ['--verdict', 'safe', 'GET', '/api/invoices/'], 'reason is required'],
  ['a finding without severity', ['--verdict', 'finding', '--reason', 'r', 'GET', '/api/invoices/'], 'needs a severity'],
  ['a ticket on safe', ['--verdict', 'safe', '--reason', 'r', '--ticket', 'https://t.example.com/1', 'GET', '/api/invoices/'], 'ticket must be'],
  ['a folded HEAD', ['--verdict', 'safe', '--reason', 'r', 'HEAD', '/api/invoices/'], 'shown with its GET'],
  ['--agent with --verdict', ['--agent', '--model', 'm', '--verdict', 'safe', 'GET', '/api/invoices/'], 'never gives a Verdict'],
])('append refuses %s and writes nothing', (_, args, message) => {
  copyFileSync(SAMPLE_LOG, tools('reviews.jsonl'));
  const before = log();
  const result = review(['append', project, ...args], { input: '' });
  expect(result.status).toBe(2);
  expect(result.stderr).toContain(message);
  expect(log()).toBe(before);
});

test('append refuses a reviewer without a git email', () => {
  writeFileSync(gitconfig, '');
  const result = review(['append', project, '--verdict', 'safe', '--reason', 'r', 'DELETE', '/api/invoices/{pk}/']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('no git user.email');
  expect(existsSync(tools('reviews.jsonl'))).toBe(false);
});

test('append asks for --handler when two handlers serve one method and path', () => {
  const inventory = JSON.parse(readFileSync(INVENTORY, 'utf8')) as { endpoints: { method: string; path: string; handler: string }[] };
  const twin = { ...inventory.endpoints.find(e => e.method === 'DELETE' && e.path === '/api/invoices/{pk}/')!, handler: 'shop/legacy.py:5' };
  inventory.endpoints.push(twin);
  writeFileSync(tools('inventory.json'), JSON.stringify(inventory));
  const args = ['append', project, '--verdict', 'safe', '--reason', 'r', 'DELETE', '/api/invoices/{pk}/'];
  const ambiguous = review(args);
  expect(ambiguous.status).toBe(2);
  expect(ambiguous.stderr).toContain('name one with --handler');
  expect(review([...args, '--handler', 'shop/legacy.py']).status).toBe(0);
  expect(events().map(e => e.endpoint)).toEqual([['DELETE', '/api/invoices/{pk}/', 'shop/legacy.py']]);
  copyFileSync(INVENTORY, tools('inventory.json'));
});

test('append --agent writes one batch of signals and triages, never a Verdict', () => {
  const input = [
    { event: 'signal_raised', method: 'POST', path: '/api/orders/{pk}/refund/', reason: 'odd', evidence: 'shop/api.py:24' },
    { event: 'signal_raised', method: 'DELETE', path: '/api/invoices/{pk}/', reason: 'odd too', evidence: 'shop/api.py:33' },
    { event: 'triaged', method: 'GET', path: '/catalog/status' },
  ]
    .map(e => JSON.stringify(e))
    .join('\n');
  const result = review(['append', project, '--agent', '--model', 'claude-opus-5-5'], { input });
  expect(result.status).toBe(0);
  const added = events();
  expect(added.map(e => e.event)).toEqual(['signal_raised', 'signal_raised', 'triaged']);
  expect(new Set(added.map(e => e.batch)).size).toBe(1);
  expect(added[0]!.batch).toMatch(/^b-[0-9a-f]{8}$/);
  expect(added.every(e => e.by === 'agent:claude-opus-5-5')).toBe(true);
  const refused = review(['append', project, '--agent', '--model', 'm'], { input: '{"event":"reviewed","method":"GET","path":"/catalog/status"}' });
  expect(refused.status).toBe(2);
  expect(events()).toHaveLength(3);
});

test('append --agent takes a lower-case method and names refused lines as they appear on stdin', () => {
  const signal = { event: 'signal_raised', path: '/api/orders/{pk}/refund/', reason: 'odd', evidence: 'shop/api.py:24' };
  expect(review(['append', project, '--agent', '--model', 'm'], { input: JSON.stringify({ ...signal, method: 'post' }) }).status).toBe(0);
  const before = log();
  for (const [input, message] of [
    [`\n\n${JSON.stringify(signal)}`, 'stdin line 3: method and path are required'],
    ['{not json', 'stdin line 1: not valid JSON'],
  ] as const) {
    const result = review(['append', project, '--agent', '--model', 'm'], { input });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
  }
  expect(log()).toBe(before);
});

test('append --agent needs a model, and the app is not there yet', () => {
  const noModel = review(['append', project, '--agent'], { input: '' });
  expect([noModel.status, noModel.stderr]).toEqual([2, '--agent needs --model <id>\n']);
  const app = review(['app', project]);
  expect([app.status, app.stderr]).toEqual([2, 'the review app is not available yet\n']);
});

test('two branches reviewing one endpoint merge without conflict, the later Verdict wins', () => {
  git('init', '-q');
  review(['append', project, '--verdict', 'safe', '--reason', 'first', 'DELETE', '/api/invoices/{pk}/']);
  git('add', '.');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'other');
  review(['append', project, '--verdict', 'finding', '--severity', 'low', '--reason', 'theirs', 'DELETE', '/api/invoices/{pk}/']);
  git('commit', '-qam', 'theirs');
  git('checkout', '-q', 'main');
  // the later `at` wins: a second apart, so the merged order cannot decide it
  execFileSync('sleep', ['1']);
  review(['append', project, '--verdict', 'accepted', '--reason', 'ours', 'DELETE', '/api/invoices/{pk}/']);
  git('commit', '-qam', 'ours');
  git('merge', '-q', '--no-edit', 'other');
  expect(events().map(e => e.reason)).toEqual(['first', 'ours', 'theirs']);
  expect(review(['status', project]).stdout).toContain('Verdicts: 1 valid (0 moot)');
  // `ours` (accepted) is the latest: the endpoint left the queue, `theirs` (a finding) would keep it at tier 1
  expect(review(['status', project, '--json']).stdout).not.toContain('"method":"DELETE","path":"/api/invoices/{pk}/"');
});
