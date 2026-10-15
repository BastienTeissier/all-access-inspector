// The Review selection: what the filters select now, a sample of it, and one Verdict for all of it.

import { keyText } from '../../../skills/all-access-inspector/review/src/inventory.ts';
import { type Projected, openFinding } from '../lib/projection.ts';
import { saveBulk } from './actions.ts';
import { VerdictForm } from './verdict-form.tsx';

const SAMPLE = 10;

const name = (r: Projected) => `${r.head ? `${r.method},HEAD` : r.method} ${r.path}`;

export const BulkPanel = ({ selection, filters, close }: { selection: Projected[]; filters: string; close: string }) => {
  const findings = selection.filter(openFinding);
  const count = `${selection.length} endpoint${selection.length === 1 ? '' : 's'}`;
  return (
    <aside className="panel" aria-label="Review selection">
      <header className="panel-head">
        <h2>Review selection · {count}</h2>
        <a href={close} className="btn" aria-label="Close">
          ×
        </a>
      </header>
      <p className="muted">One Verdict for each endpoint the filters select when you save, all in one batch.</p>
      <ul className="sample">
        {selection.slice(0, SAMPLE).map(r => (
          <li key={keyText(r.key)}>
            <span className="path">{name(r)}</span>
          </li>
        ))}
        {selection.length > SAMPLE && <li className="muted">and {selection.length - SAMPLE} more</li>}
      </ul>
      {findings.length > 0 && (
        <p className="note-box error">
          The selection holds an open finding: {findings.map(name).join(', ')}. Saving replaces it.
        </p>
      )}
      <VerdictForm
        save={saveBulk}
        hidden={{ filters }}
        submit={`Review all ${count}`}
        confirm={findings.length ? `Replace the open finding${findings.length === 1 ? '' : 's'} on ${findings.map(name).join(', ')}` : undefined}
      />
    </aside>
  );
};
