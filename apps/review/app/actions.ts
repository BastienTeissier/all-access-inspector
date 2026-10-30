'use server';

// Saving a Verdict, on one row or on the Review selection: the same checks and the same append as `review append`; and
// a Capability Decision on one cell of the access map, as `map decide`.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { project as mapProject } from '../../../skills/all-access-inspector/map/src/data.ts';
import { appendBulk, appendDecision, appendVerdict } from '../../../skills/all-access-inspector/review/src/append.ts';
import { InventoryError, type Key, keyText } from '../../../skills/all-access-inspector/review/src/inventory.ts';
import { Refused } from '../../../skills/all-access-inspector/review/src/project.ts';
import { filtersOf, href, projectDir } from '../lib/filters.ts';
import { accessMap, confirmation, endpointName, openFinding, project, queue } from '../lib/projection.ts';

export interface FormState {
  errors: { verdict?: string; reason?: string; severity?: string; confirm?: string; form?: string };
  /** The confirmation the selection needs at save time, which the form shows in place of the one it rendered with. */
  confirm?: { label: string; value: string };
}

const text = (form: FormData, name: string): string | undefined => {
  const value = String(form.get(name) ?? '').trim();
  return value || undefined;
};

/** The Review Key the form posted, or null when it is not one. */
const keyOf = (value: FormDataEntryValue | null): Key | null => {
  try {
    const key: unknown = JSON.parse(String(value));
    return Array.isArray(key) && key.length === 3 && key.every(k => typeof k === 'string') ? (key as Key) : null;
  } catch {
    return null;
  }
};

/** What is missing from the Verdict fields, or null; nothing is written while anything is. */
const fieldErrors = (form: FormData): FormState['errors'] | null => {
  const errors: FormState['errors'] = {};
  if (!text(form, 'verdict')) errors.verdict = 'Pick a verdict.';
  if (!text(form, 'reason')) errors.reason = 'A reason is required.';
  if (text(form, 'verdict') === 'finding' && !text(form, 'severity')) errors.severity = 'A finding needs a severity.';
  return Object.keys(errors).length ? errors : null;
};

/** The Verdict as `review append` takes it: severity and ticket only on a finding, until only on accepted. */
const values = (form: FormData) => {
  const verdict = text(form, 'verdict');
  return {
    verdict,
    reason: text(form, 'reason'),
    ...(verdict === 'finding' ? { severity: text(form, 'severity'), ticket: text(form, 'ticket') } : {}),
    ...(verdict === 'accepted' ? { until: text(form, 'until') } : {}),
  };
};

const filtersFrom = (form: FormData) => filtersOf(new URLSearchParams(String(form.get('filters') ?? '')));

/** Runs an append; a refusal is the form's error, anything else is a bug. */
const appended = (write: () => unknown): FormState | null => {
  try {
    write();
    return null;
  } catch (error) {
    if (error instanceof Refused || error instanceof InventoryError) return { errors: { form: error.message } };
    throw error;
  }
};

export const saveVerdict = async (_previous: FormState, form: FormData): Promise<FormState> => {
  const key = keyOf(form.get('key'));
  if (!key) return { errors: { form: 'This endpoint is not in the inventory: reload the page.' } };
  const filters = filtersFrom(form);
  const errors = fieldErrors(form);
  if (errors) return { errors };
  const dir = projectDir();
  const { db } = project(dir);
  const rows = db ? queue(db, filters) : [];
  const at = rows.findIndex(r => keyText(r.key) === keyText(key));
  const tier = rows[at]?.tier;
  const next = at < 0 ? undefined : rows.slice(at + 1).find(r => r.tier === tier);
  const refused = appended(() => appendVerdict(dir, { ...values(form), handler: key[2] }, [key[0], key[1]]));
  if (refused) return refused;
  revalidatePath('/');
  redirect(href(filters, next && keyText(next.key)));
};

/**
 * The Review selection: one Verdict on every row the filters select when it is saved, recomputed here rather than taken
 * from the page. A selection holding an open finding is written only once the reviewer confirmed replacing it.
 */
export const saveBulk = async (_previous: FormState, form: FormData): Promise<FormState> => {
  const filters = filtersFrom(form);
  const errors = fieldErrors(form);
  if (errors) return { errors };
  const dir = projectDir();
  const { db } = project(dir);
  const selection = db ? queue(db, filters) : [];
  const needed = confirmation(selection);
  if (needed && form.get('confirmFinding') !== needed.value) {
    const names = selection.filter(openFinding).map(endpointName).join(', ');
    return { errors: { confirm: `Confirm to replace the open finding on ${names}.` }, confirm: needed };
  }
  const refused = appended(() => appendBulk(dir, values(form), selection.map(r => r.key)));
  if (refused) return refused;
  revalidatePath('/');
  redirect(href(filters));
};

/** The cell the form posted, or null when it is not one. */
const cellOf = (value: FormDataEntryValue | null): [string, string] | null => {
  try {
    const cell: unknown = JSON.parse(String(value));
    return Array.isArray(cell) && cell.length === 2 && cell.every(k => typeof k === 'string') ? (cell as [string, string]) : null;
  } catch {
    return null;
  }
};

/** A Capability Decision on one cell, recording the cell as the map computes it now; then the next undecided partial. */
export const saveDecision = async (_previous: FormState, form: FormData): Promise<FormState> => {
  const cell = cellOf(form.get('cell'));
  if (!cell) return { errors: { form: 'This cell is not on the access map: reload the page.' } };
  const errors = fieldErrors(form);
  if (errors) return { errors };
  const dir = projectDir();
  let seen;
  try {
    seen = mapProject(dir).cells.find(c => c.capability === cell[0] && c.role === cell[1])?.seen;
  } catch (error) {
    return { errors: { form: (error as Error).message } };
  }
  if (!seen) return { errors: { form: 'This cell is no longer on the access map: reload the page.' } };
  const refused = appended(() => appendDecision(dir, values(form), cell, seen));
  if (refused) return refused;
  revalidatePath('/map');
  const next = accessMap(dir).data?.alerts.find(a => a.kind === 'undecided')?.cell;
  redirect(next ? `/map?tab=roles&cap=${encodeURIComponent(next[0])}&role=${encodeURIComponent(next[1])}` : '/map?tab=alerts');
};
