// The endpoint panel: everything needed to judge one row, then its Verdict form.

import { type Axis, type SeenAxis, classification, keyText } from '../../../skills/all-access-inspector/review/src/inventory.ts';
import type { Logged } from '../../../skills/all-access-inspector/review/src/log.ts';
import type { Orphan } from '../../../skills/all-access-inspector/review/src/replay.ts';
import type { Projected } from '../lib/projection.ts';
import { eventText } from '../lib/history.ts';
import { saveVerdict } from './actions.ts';
import { VerdictForm } from './verdict-form.tsx';

const FIELDS = ['value', 'layer', 'raw', 'rule', 'evidence'] as const;

/** `file:line` as a link that opens the editor there; anything else (a dotted framework name) as text. */
const Source = ({ project, at }: { project: string; at: string | null }) => {
  if (!at) return <span className="muted">—</span>;
  const match = /^([^\s:]+):(\d+)$/.exec(at);
  if (!match) return <code>{at}</code>;
  return (
    <a href={`vscode://file${project}/${match[1]}:${match[2]}`}>
      <code>{at}</code>
    </a>
  );
};

const AxisTable = ({ title, axis, project }: { title: string; axis: Axis; project: string }) => (
  <table className="axis">
    <caption>{title}</caption>
    <tbody>
      {FIELDS.map(f => (
        <tr key={f}>
          <th scope="row">{f}</th>
          <td>{f === 'evidence' ? <Source project={project} at={axis.evidence} /> : axis[f] ? <code>{axis[f]}</code> : <span className="muted">—</span>}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const seenText = (a: SeenAxis) => [a.value, a.layer, a.raw, a.rule].map(v => v ?? '—').join(' · ');

export const EndpointPanel = ({
  row,
  siblings,
  history,
  candidates,
  project,
  filters,
  close,
}: {
  row: Projected;
  siblings: Projected[];
  history: Logged[];
  /** Orphaned Verdicts this endpoint may have been, renamed or moved. */
  candidates: Orphan[];
  project: string;
  filters: string;
  close: string;
}) => {
  const outdated = row.state === 'outdated' ? row.verdict : null;
  return (
    <aside className="panel" aria-label="Endpoint">
      <header className="panel-head">
        <h2>
          <span className="m">{row.head ? `${row.method},HEAD` : row.method}</span> <span className="path">{row.path}</span>
        </h2>
        <a href={close} className="btn" aria-label="Close">
          ×
        </a>
      </header>
      <p>
        Handler <Source project={project} at={row.handler} /> · {classification(row)} · tier {row.tier}
        {row.state === 'valid' && row.verdict && ` · ${row.verdict.verdict} by ${row.verdict.by}`}
      </p>
      {row.unknown_reason && <p className="note-box">{row.unknown_reason}</p>}
      <div className="axes">
        <AxisTable title="Authentication" axis={row.authentication} project={project} />
        <AxisTable title="Authorization" axis={row.authorization} project={project} />
      </div>
      {outdated && (
        <section className="outdated" aria-label="Outdated verdict">
          <h3>
            Outdated {outdated.verdict} by {outdated.by}
          </h3>
          {row.expired ? (
            <p>Accepted until {outdated.until}, which has passed.</p>
          ) : (
            <table className="compare">
              <thead>
                <tr>
                  <th />
                  <th scope="col">Reviewed</th>
                  <th scope="col">Now</th>
                </tr>
              </thead>
              <tbody>
                {(['authentication', 'authorization'] as const).map(a => (
                  <tr key={a}>
                    <th scope="row">{a}</th>
                    <td>
                      <code>{seenText(outdated.seen[a])}</code>
                    </td>
                    <td>
                      <code>{seenText(row[a])}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      <section aria-label="Signals">
        <h3>Signals</h3>
        {row.signals.length ? (
          <ul>
            {row.signals.map(s => (
              <li key={s.id}>
                <span className="chip l-unknown">{s.id}</span> {s.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None.</p>
        )}
      </section>
      <section aria-label="Siblings">
        <h3>Siblings</h3>
        {siblings.length ? (
          <ul>
            {siblings.map(s => (
              <li key={keyText(s.key)}>
                <span className="m">{s.method}</span> <span className="path">{s.path}</span> {classification(s)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No related endpoint with a different access.</p>
        )}
      </section>
      <section aria-label="History">
        <h3>History</h3>
        {history.length ? (
          <ol className="history">
            {history.map(e => (
              <li key={e.line}>
                <span className="muted">
                  {e.at} · {e.by}
                </span>{' '}
                {eventText(e)}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">No event yet.</p>
        )}
      </section>
      <VerdictForm
        key={keyText(row.key)}
        save={saveVerdict}
        hidden={{ key: keyText(row.key), filters }}
        submit="Save verdict"
        reason={outdated?.reason}
        candidates={candidates.map(o => ({ endpoint: `${o.key[0]} ${o.key[1]} (${o.key[2]})`, verdict: o.verdict.verdict, reason: o.verdict.reason }))}
      />
    </aside>
  );
};
