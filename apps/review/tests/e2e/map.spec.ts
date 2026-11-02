// UF18 in the browser: the fixture's access map in the app, a decision saved from the cell panel, the static page alike.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { type Page, expect, test } from '@playwright/test';

import { MAP_CLI, dir, env, log, reset } from './project.ts';

test.beforeEach(reset);

const CELL = 'td.cell [data-cap="export-orders"][data-role="clerk"]';

/** Every cell's state as drawn: `[capability, role, state]`, from the app's links or the static page's buttons. */
const states = (page: Page) =>
  page.locator('td.cell [data-cap]').evaluateAll(cells =>
    cells.map(c => [c.getAttribute('data-cap'), c.getAttribute('data-role'), /\bc-(\w+)/.exec(c.querySelector('[class*="c-"]')!.className)![1]]),
  );

/** The Alerts tab as drawn: the count, each Coverage line as `name count`, and the queue line. */
const alertsTab = async (page: Page) => ({
  count: await page.locator('#alert-count').textContent(),
  coverage: await page.locator('details[aria-label="Coverage"] li').evaluateAll(lines => lines.map(l => l.textContent!.replace(/\s+/g, ' ').trim())),
  queue: await page.locator('#queue').textContent(),
});

const decide = async (page: Page, verdict: string, reason: string) => {
  await page.goto('/map');
  await page.locator(CELL).click();
  await page.getByRole('radio', { name: verdict }).check();
  await page.getByLabel('Reason').fill(reason);
};

test('a finding decided on the partial cell is one decided line and an open finding', async ({ page }) => {
  await decide(page, 'finding', 'Clerks must not export orders');
  await page.getByLabel('Severity').selectOption('high');
  await page.getByLabel('Ticket URL').fill('https://tracker.example.com/SEC-1');
  await page.getByRole('button', { name: 'Save decision' }).click();
  await expect(page).toHaveURL(/tab=alerts/);
  await expect(page.getByRole('group', { name: 'Findings' })).toContainText('Export orders for Clerk: Clerks must not export orders');
  await expect(page.getByText('Partial, not decided')).toHaveCount(0);
  await expect(page.getByText('1 event not committed')).toBeVisible();
  const lines = log().trimEnd().split('\n');
  const decided = lines.map(l => JSON.parse(l)).filter(e => e.event === 'decided');
  expect(decided).toEqual([
    expect.objectContaining({
      capability: ['export-orders', 'clerk'],
      verdict: 'finding',
      severity: 'high',
      ticket: 'https://tracker.example.com/SEC-1',
      by: 'reviewer@example.com',
      seen: expect.objectContaining({ state: 'partial' }),
    }),
  ]);
  await page.goto('/history');
  await expect(page.getByRole('region', { name: 'Batches' })).toContainText('export-orders for clerk');
  await expect(page.getByRole('region', { name: 'Orphaned decisions' })).toContainText('Every Decision names a cell of the access map.');
});

test('a decision without a reason, or a finding without a severity, is flagged and nothing is written', async ({ page }) => {
  const before = log();
  await decide(page, 'safe', '');
  await page.getByRole('button', { name: 'Save decision' }).click();
  await expect(page.getByText('A reason is required.')).toBeVisible();
  await page.getByRole('radio', { name: 'finding' }).check();
  await page.getByLabel('Reason').fill('Clerks must not export orders');
  await page.getByRole('button', { name: 'Save decision' }).click();
  await expect(page.getByText('A finding needs a severity.')).toBeVisible();
  await expect(page.getByLabel('Reason')).toHaveValue('Clerks must not export orders');
  expect(log()).toBe(before);
});

test('an invalid vocabulary shows the error and the last good map', async ({ page }) => {
  const vocabulary = join(dir(), 'tools', 'access-map', 'vocabulary.json');
  const good = readFileSync(vocabulary, 'utf8');
  await page.goto('/map');
  const shown = await states(page);
  try {
    writeFileSync(vocabulary, '{');
    await page.reload();
    await expect(page.locator('p[role=alert]')).toContainText('not valid JSON');
    await expect(page.locator('p[role=alert]')).toContainText('showing the last map that could be built');
    expect(await states(page)).toEqual(shown);
  } finally {
    writeFileSync(vocabulary, good);
  }
});

test('the Alerts count is the undecided, findings and open lines; coverage and the queue are counted apart', async ({ page }) => {
  await page.goto('/map?tab=alerts');
  const lines = await page.locator(['Partial, not decided', 'Findings', 'Not resolved'].map(g => `details[aria-label="${g}"] li`).join(', ')).count();
  expect(lines).toBeGreaterThan(0);
  expect(await alertsTab(page)).toEqual({ count: String(lines), coverage: ['Orders 3', 'api.invoices 2', 'no area 32', 'Third-party handlers 21'], queue: 'Review queue: 48 signals' });
});

test('a Coverage line opens the Routes tab filtered on that area and behind no capability', async ({ page }) => {
  await page.goto('/map?tab=alerts');
  const coverage = page.getByRole('group', { name: 'Coverage' });
  await coverage.getByText('Coverage').click();
  await coverage.getByRole('link', { name: 'Orders' }).click();
  await expect(page).toHaveURL(/tab=routes&gap=shop\.order/);
  await expect(page.getByText(/^3 of \d+ routes$/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Routes' }).locator('ul.routes > li')).toHaveCount(3);
});

test('the queue line links to the review queue', async ({ page }) => {
  await page.goto('/map?tab=alerts');
  await page.getByRole('link', { name: 'Review queue: 48 signals' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('the static page built from the same files shows the same cell states and Alerts tab', async ({ page }) => {
  const out = join(dir(), '..', 'access-map.html');
  execFileSync(process.execPath, [MAP_CLI, 'build', dir(), '--out', out], { env: env() });
  await page.goto('/map');
  const shown = await states(page);
  await page.goto('/map?tab=alerts');
  const app = { states: shown, alerts: await alertsTab(page) };
  expect(app.states.length).toBeGreaterThan(0);
  await page.goto(pathToFileURL(out).href);
  expect({ states: await states(page), alerts: await alertsTab(page) }).toEqual(app);
  await page.goto(`${pathToFileURL(out).href}#routes?gap=shop.order`);
  await page.reload();
  await expect(page.locator('#rcount')).toHaveText(/^3 of \d+ routes$/);
});
