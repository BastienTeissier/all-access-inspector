// UF14 in the browser: the queue as `review status` has it, a Verdict saved from the panel, and the files as the truth.

import { request as get } from 'node:http';
import { type Socket, connect } from 'node:net';
import { networkInterfaces } from 'node:os';

import { expect, test } from '@playwright/test';

import { log, reset, review, status } from './project.ts';

test.beforeEach(reset);

const keyOf = (row: { key: string[] }) => JSON.stringify(row.key);

test('the queue matches review status', async ({ page }) => {
  await page.goto('/');
  const shown = await page.locator('section.tier').evaluateAll(sections =>
    sections.flatMap(s => {
      const tier = Number(/Tier (\d+)/.exec(s.querySelector('h2')!.textContent!)![1]);
      return [...s.querySelectorAll('tr[data-key]')].map(tr => [tr.getAttribute('data-key'), tier]);
    }),
  );
  expect(shown).toEqual(status().map(r => [keyOf(r), r.tier]));
});

test('saving a verdict appends it and opens the next row of the tier', async ({ page }) => {
  const [first, second] = status().filter(r => r.tier === 8);
  await page.goto('/?tier=8');
  await page.locator(`tr[data-key='${keyOf(first!)}'] a`).click();
  await page.getByRole('radio', { name: 'safe' }).check();
  await page.getByLabel('Reason').fill('only the allowed methods, no data');
  await page.getByRole('button', { name: 'Save verdict' }).click();
  await expect(page.locator('tr[aria-current="true"]')).toHaveAttribute('data-key', keyOf(second!));
  await expect(page.locator(`tr[data-key='${keyOf(first!)}']`)).toHaveCount(0);
  await expect(page.getByText('1 event not committed')).toBeVisible();
  const last = JSON.parse(log().trimEnd().split('\n').at(-1)!);
  expect(last).toMatchObject({ event: 'reviewed', verdict: 'safe', endpoint: first!.key, by: 'reviewer@example.com' });
});

test('a finding without a severity is flagged and nothing is written', async ({ page }) => {
  const before = log();
  const [row] = status().filter(r => r.tier === 8);
  await page.goto(`/?e=${encodeURIComponent(keyOf(row!))}`);
  await page.getByRole('radio', { name: 'finding' }).check();
  await page.getByLabel('Reason').fill('any user reads any invoice');
  await page.getByRole('button', { name: 'Save verdict' }).click();
  await expect(page.getByText('A finding needs a severity.')).toBeVisible();
  await expect(page.getByLabel('Reason')).toHaveValue('any user reads any invoice');
  await expect(page.getByRole('radio', { name: 'finding' })).toBeChecked();
  expect(log()).toBe(before);
});

test('a form posting no Review Key is refused and nothing is written', async ({ page }) => {
  const before = log();
  const [row] = status().filter(r => r.tier === 8);
  await page.goto(`/?e=${encodeURIComponent(keyOf(row!))}`);
  await page.getByRole('radio', { name: 'safe' }).check();
  await page.getByLabel('Reason').fill('only the allowed methods');
  // after the last re-render, which would put the key back
  await page.locator('input[name="key"]').evaluate(input => {
    (input as HTMLInputElement).value = 'not a key';
  });
  await page.getByRole('button', { name: 'Save verdict' }).click();
  await expect(page.getByText('This endpoint is not in the inventory: reload the page.')).toBeVisible();
  expect(log()).toBe(before);
});

test('an outdated verdict shows what was reviewed beside what is now, its reason prefilled', async ({ page }) => {
  const row = status().find(r => r.state === 'outdated' && r.method === 'GET' && r.path === '/reports/{slug}')!;
  await page.goto(`/?e=${encodeURIComponent(keyOf(row))}`);
  const outdated = page.getByRole('region', { name: 'Outdated verdict' });
  await expect(outdated.getByRole('columnheader', { name: 'Reviewed' })).toBeVisible();
  await expect(outdated.getByRole('row', { name: /authorization/ })).toContainText('rule');
  await expect(page.getByLabel('Reason')).toHaveValue(row.verdict!.reason);
});

test('a line appended outside the app shows on reload, without a restart', async ({ page }) => {
  const [row] = status().filter(r => r.tier === 8);
  await page.goto('/?tier=8');
  await expect(page.locator(`tr[data-key='${keyOf(row!)}']`)).toHaveCount(1);
  review('append', '.', '--verdict', 'safe', '--reason', 'from the CLI', row!.method, row!.path);
  await page.reload();
  await expect(page.locator(`tr[data-key='${keyOf(row!)}']`)).toHaveCount(0);
});

test('the app listens on 127.0.0.1 only and answers no other host name', async () => {
  const url = new URL(process.env.REVIEW_URL!);
  expect(url.hostname).toBe('127.0.0.1');
  const status = await new Promise<number | undefined>((done, fail) =>
    get({ host: url.hostname, port: url.port, path: '/', headers: { host: `rebound.example:${url.port}` } }, r => done(r.statusCode))
      .on('error', fail)
      .end(),
  );
  expect(status).toBe(403);
  const outside = Object.values(networkInterfaces()).flat().find(i => i && !i.internal && i.family === 'IPv4');
  test.skip(!outside, 'no network interface besides loopback');
  const refused = await new Promise<boolean>(done =>
    connect({ host: outside!.address, port: Number(url.port), timeout: 2000 })
      .once('connect', function (this: Socket) {
        this.destroy();
        done(false);
      })
      .once('timeout', function (this: Socket) {
        this.destroy();
        done(true);
      })
      .once('error', () => done(true)),
  );
  expect(refused).toBe(true);
});
