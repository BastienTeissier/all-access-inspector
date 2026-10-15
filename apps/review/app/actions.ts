'use server';

// Saving a Verdict: the same checks and the same append as `review append`, then the next row of the same tier.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { appendVerdict } from '../../../skills/all-access-inspector/review/src/append.ts';
import { InventoryError, type Key, keyText } from '../../../skills/all-access-inspector/review/src/inventory.ts';
import { Refused } from '../../../skills/all-access-inspector/review/src/project.ts';
import { filtersOf, href, projectDir } from '../lib/filters.ts';
import { project, queue } from '../lib/projection.ts';

export interface FormState {
  errors: { verdict?: string; reason?: string; severity?: string; form?: string };
}

const text = (form: FormData, name: string): string | undefined => {
  const value = String(form.get(name) ?? '').trim();
  return value || undefined;
};

export const saveVerdict = async (_previous: FormState, form: FormData): Promise<FormState> => {
  const key = JSON.parse(String(form.get('key'))) as Key;
  const filters = filtersOf(new URLSearchParams(String(form.get('filters') ?? '')));
  const verdict = text(form, 'verdict');
  const reason = text(form, 'reason');
  const severity = text(form, 'severity');
  const errors: FormState['errors'] = {};
  if (!verdict) errors.verdict = 'Pick a verdict.';
  if (!reason) errors.reason = 'A reason is required.';
  if (verdict === 'finding' && !severity) errors.severity = 'A finding needs a severity.';
  if (Object.keys(errors).length) return { errors };

  const dir = projectDir();
  const { db } = project(dir);
  const rows = db ? queue(db, filters) : [];
  const at = rows.findIndex(r => keyText(r.key) === keyText(key));
  const next = at < 0 ? undefined : rows.slice(at + 1).find(r => r.tier === rows[at]!.tier);
  try {
    appendVerdict(
      dir,
      {
        verdict,
        reason,
        handler: key[2],
        ...(verdict === 'finding' ? { severity, ticket: text(form, 'ticket') } : {}),
        ...(verdict === 'accepted' ? { until: text(form, 'until') } : {}),
      },
      [key[0], key[1]],
    );
  } catch (error) {
    if (error instanceof Refused || error instanceof InventoryError) return { errors: { form: error.message } };
    throw error;
  }
  revalidatePath('/');
  redirect(href(filters, next && keyText(next.key)));
};
