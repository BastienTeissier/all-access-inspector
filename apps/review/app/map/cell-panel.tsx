// The cell panel: why one role has that access to one capability, the endpoints it reaches and misses, the cell's
// decisions, then the decision form (UF17).

import type { PageData } from '../../../../skills/all-access-inspector/map/src/data.ts';
import { type Key, keyText } from '../../../../skills/all-access-inspector/review/src/inventory.ts';
import type { LoggedCell } from '../../../../skills/all-access-inspector/review/src/log.ts';
import { eventText } from '../../lib/history.ts';
import { saveDecision } from '../actions.ts';
import { VerdictForm } from '../verdict-form.tsx';
import { BASIS, STATE, StateChip, Who } from './labels.tsx';

export const CellPanel = ({ data, cap, role, history }: { data: PageData; cap: string; role: string; history: LoggedCell[] }) => {
  const c = data.areas.flatMap(a => a.capabilities).find(x => x.id === cap);
  const r = data.roles.find(x => x.id === role);
  const v = data.cells.find(x => x.capability === cap && x.role === role);
  if (!c || !r || !v) return null;
  const d = v.decision;
  const endpoint = (key: Key) => {
    const e = data.endpoints.find(x => keyText(x.key) === keyText(key));
    return (
      e && (
        <li key={keyText(key)}>
          <span className="m">{e.method}</span>{' '}
          <a href={`/?e=${encodeURIComponent(keyText(e.key))}`} className="path">
            {e.path}
          </a>{' '}
          <Who who={e.who} roles={data.roles} />
        </li>
      )
    );
  };
  return (
    <aside className="panel" aria-label="Cell">
      <header className="panel-head">
        <div>
          <div className="brand">
            {data.areas.find(a => a.id === c.area)?.name ?? c.area} · {r.name}
          </div>
          <h2>{c.name}</h2>
        </div>
        <a href="/map?tab=roles" className="btn" aria-label="Close">
          ×
        </a>
      </header>
      <p>
        <StateChip state={v.state} basis={v.basis} /> {STATE[v.state]?.[1]}, {BASIS[v.basis]}
        {v.scope && (
          <>
            {' '}
            · records: {v.scope.label} <code>{v.scope.at}</code>
          </>
        )}
      </p>
      {v.state === 'partial' && (
        <p className="note-box">
          Reaches {v.seen.reached.length} of {v.seen.reached.length + v.seen.missed.length} endpoints. A partial cell needs a decision.
        </p>
      )}
      <h3>Enforced by</h3>
      <p>
        <code>{c.check}</code>
        {c.at && (
          <>
            {' '}
            at <code>{c.at}</code>
          </>
        )}{' '}
        <span className="muted">{BASIS[c.basis]}</span>
        {c.reason && <span className="muted"> · {c.reason}</span>}
      </p>
      {r.at && (
        <p className="muted">
          Role <code>{r.at}</code>
          {r.includes.length > 0 && ` · includes ${r.includes.map(i => data.roles.find(x => x.id === i)?.name ?? i).join(', ')}`}
          {r.staff && ' · staff'}
        </p>
      )}
      <section aria-label="Reached">
        <h3>Reached ({v.seen.reached.length})</h3>
        {v.seen.reached.length ? <ul>{v.seen.reached.map(endpoint)}</ul> : <p className="muted">None.</p>}
      </section>
      <section aria-label="Not reached">
        <h3>Not reached ({v.seen.missed.length})</h3>
        {v.seen.missed.length ? <ul>{v.seen.missed.map(endpoint)}</ul> : <p className="muted">None.</p>}
      </section>
      <p>
        <a href={`/map?tab=routes&cap=${encodeURIComponent(c.id)}`}>Show the check chain of these routes →</a>
      </p>
      <section aria-label="Decisions">
        <h3>Decisions</h3>
        {d && (
          <p>
            <b>
              {d.verdict}
              {d.severity && ` (${d.severity})`}
            </b>
            {d.state === 'outdated' && <span className="field-error"> outdated: the cell changed{d.expired && ', until has passed'}</span>}
            {d.ticket && (
              <>
                {' '}
                · <a href={d.ticket}>{d.ticket}</a>
              </>
            )}
          </p>
        )}
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
          <p className="muted">No decision yet.</p>
        )}
      </section>
      <VerdictForm
        key={`${cap} ${role}`}
        save={saveDecision}
        hidden={{ cell: JSON.stringify([cap, role]) }}
        submit="Save decision"
        reason={d?.state === 'outdated' ? d.reason : undefined}
      />
    </aside>
  );
};
