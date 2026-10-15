'use client';

// The Verdict form, of one endpoint or of the Review selection: field errors shown in place, nothing written on an error.
// Submitted from onSubmit rather than `action`: React resets a form after its action, and an error must not lose what was
// typed or chosen.

import { startTransition, useActionState, useState } from 'react';

import type { FormState } from './actions.ts';

export const VerdictForm = ({
  save,
  hidden,
  submit,
  reason,
  confirm,
}: {
  save: (previous: FormState, form: FormData) => Promise<FormState>;
  /** What the action reads besides the fields: the key, the filters. */
  hidden: Record<string, string>;
  submit: string;
  reason?: string;
  /** Shown as a checkbox the reviewer ticks before saving, when the save replaces an open finding. */
  confirm?: string;
}) => {
  const [state, action, pending] = useActionState<FormState, FormData>(save, { errors: {} });
  const [fields, setFields] = useState({ verdict: '', reason: reason ?? '', severity: '', ticket: '', until: '' });
  const field = (name: keyof typeof fields) => ({
    name,
    value: fields[name],
    onChange: (e: { target: { value: string } }) => setFields({ ...fields, [name]: e.target.value }),
  });
  const verdict = fields.verdict;
  const { errors } = state;
  return (
    <form
      className="verdict-form"
      aria-label="Verdict"
      onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        startTransition(() => action(form));
      }}
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <fieldset aria-invalid={Boolean(errors.verdict)}>
        <legend>Verdict</legend>
        {['safe', 'accepted', 'finding'].map(v => (
          <label key={v} className="choice">
            <input type="radio" name="verdict" value={v} checked={verdict === v} onChange={() => setFields({ ...fields, verdict: v })} /> {v}
          </label>
        ))}
        {errors.verdict && <p className="field-error">{errors.verdict}</p>}
      </fieldset>
      <label>
        Reason
        <textarea {...field('reason')} rows={3} maxLength={2000} aria-invalid={Boolean(errors.reason)} />
      </label>
      {errors.reason && <p className="field-error">{errors.reason}</p>}
      {verdict === 'finding' && (
        <>
          <label>
            Severity
            <select {...field('severity')} aria-invalid={Boolean(errors.severity)}>
              <option value="">—</option>
              <option>low</option>
              <option>medium</option>
              <option>high</option>
            </select>
          </label>
          {errors.severity && <p className="field-error">{errors.severity}</p>}
          <label>
            Ticket URL <span className="muted">(optional)</span>
            <input type="url" {...field('ticket')} placeholder="https://" />
          </label>
        </>
      )}
      {verdict === 'accepted' && (
        <label>
          Until <span className="muted">(optional)</span>
          <input type="date" {...field('until')} />
        </label>
      )}
      {confirm && (
        <label className="choice">
          <input type="checkbox" name="confirmFinding" value="yes" aria-invalid={Boolean(errors.confirm)} /> {confirm}
        </label>
      )}
      {errors.confirm && <p className="field-error">{errors.confirm}</p>}
      {errors.form && <p className="field-error">{errors.form}</p>}
      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? 'Saving…' : submit}
      </button>
    </form>
  );
};
