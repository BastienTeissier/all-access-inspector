// UF15 in the browser: the Review selection, one event per endpoint selected at save time, in one batch.

import { expect, test } from '@playwright/test';

import { log, orphans, reset, status } from './project.ts';

test.beforeEach(reset);

const added = (before: string) => log().slice(before.length).trimEnd().split('\n').filter(Boolean).map(l => JSON.parse(l));

test('a Review selection writes one event per selected endpoint, in one batch', async ({ page }) => {
  const selected = status().filter(r => r.tier === 11);
  expect(selected.length).toBeGreaterThan(1);
  const before = log();
  await page.goto('/?tier=11');
  await page.getByRole('button', { name: 'Review selection' }).click();
  const panel = page.getByRole('complementary', { name: 'Review selection' });
  await expect(panel.getByRole('heading')).toContainText(`${selected.length} endpoints`);
  await panel.getByRole('radio', { name: 'safe' }).check();
  await panel.getByLabel('Reason').fill('one rule guards them all');
  await panel.getByRole('button', { name: `Review all ${selected.length} endpoints` }).click();
  await expect(page.getByRole('button', { name: 'Review selection' })).toBeDisabled();
  const events = added(before);
  expect(events).toHaveLength(selected.length + selected.filter(r => r.head).length);
  expect(new Set(events.map(e => e.batch)).size).toBe(1);
  expect(events[0].batch).toMatch(/^b-[0-9a-f]{8}$/);
  const keys = new Set(events.map(e => JSON.stringify(e.endpoint)));
  for (const r of selected) expect(keys).toContain(JSON.stringify(r.key));
  await page.getByRole('link', { name: 'History' }).click();
  const newest = page.getByRole('region', { name: 'Batches' }).locator('summary').first();
  await expect(newest).toContainText('reviewer@example.com');
  await expect(newest).toContainText(`safe ×${events.length} · ${events.length} endpoints · one rule guards them all`);
});

test('History shows agent runs by their model and the orphaned Verdicts', async ({ page }) => {
  const orphaned = orphans();
  expect(orphaned.length).toBeGreaterThan(0);
  await page.goto('/history');
  await expect(page.getByRole('region', { name: 'Batches' }).locator('summary', { hasText: 'agent · claude-opus-5-5' })).toContainText('2 endpoints');
  const listed = page.getByRole('region', { name: 'Orphaned verdicts' });
  await expect(listed.getByRole('heading')).toHaveText(`Orphaned verdicts (${orphaned.length})`);
  for (const o of orphaned) await expect(listed.getByRole('row', { name: new RegExp(o.path) })).toContainText(o.reason);
});

test('a selection holding an open finding names it and writes nothing until confirmed', async ({ page }) => {
  const finding = status().find(r => r.state === 'valid' && r.verdict?.verdict === 'finding')!;
  const before = log();
  await page.goto(`/?tier=1&q=${encodeURIComponent(finding.path)}`);
  await page.getByRole('button', { name: 'Review selection' }).click();
  const panel = page.getByRole('complementary', { name: 'Review selection' });
  await expect(panel.getByText(/The selection holds an open finding/)).toContainText(finding.path);
  await panel.getByRole('radio', { name: 'accepted' }).check();
  await panel.getByLabel('Reason').fill('fixed upstream, tracked in the ticket');
  await panel.getByRole('button', { name: /^Review all/ }).click();
  await expect(panel.getByText(/^Confirm to replace the open finding on/)).toBeVisible();
  expect(log()).toBe(before);
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: /^Review all/ }).click();
  await expect(page.getByRole('button', { name: 'Review selection' })).toBeDisabled();
  expect(added(before).map(e => [e.verdict, e.endpoint[1]])).toContainEqual(['accepted', finding.path]);
});
