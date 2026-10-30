// The Review Queue: the header, the filters, the rows by tier, and the panel of the open endpoint.

import { basename } from 'node:path';

import { keyText } from '../../../skills/all-access-inspector/review/src/inventory.ts';
import { SIGNAL_IDS } from '../../../skills/all-access-inspector/review/src/signals.ts';
import { TIERS } from '../../../skills/all-access-inspector/review/src/tiers.ts';
import { FILTERS, filtersOf, href, projectDir } from '../lib/filters.ts';
import { candidates } from '../lib/history.ts';
import { type Projected, hasMap, header, history, orphans, project, queue, row, uncommitted, zones } from '../lib/projection.ts';
import { BulkPanel } from './bulk-panel.tsx';
import { EndpointPanel } from './endpoint-panel.tsx';

export const dynamic = 'force-dynamic';

const STATES = ['none', 'outdated'];

const Select = ({ name, label, value, options }: { name: string; label: string; value?: string; options: [string, string][] }) => (
  <label>
    {label}
    <select name={name} defaultValue={value ?? ''}>
      <option value="">all</option>
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  </label>
);

export default async function Queue({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams(Object.entries(await searchParams).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])));
  const filters = filtersOf(params);
  const dir = projectDir();
  const { db, error, project: abs } = project(dir);
  if (!db)
    return (
      <main className="wrap">
        <h1>Cannot review {dir}</h1>
        <p className="note-box error">{error}</p>
      </main>
    );
  const head = header(db);
  const rows = queue(db, filters);
  const pending = uncommitted(abs);
  const open = params.get('e');
  const selected = open ? row(db, open) : null;
  const bulk = !selected && params.get('bulk') === '1';
  const filterText = new URLSearchParams(Object.entries(filters)).toString();
  const tiers = [...new Set(rows.map(r => r.tier))];
  return (
    <main className={selected || bulk ? 'wrap with-panel' : 'wrap'}>
      <header className="top">
        <div>
          <div className="brand">
            <span className="dot" /> access review
          </div>
          <h1>{basename(abs)}</h1>
        </div>
        <div className="facts">
          <span className="fact">
            <b>{head.stack}</b> · {head.coverage} · {head.endpoints} endpoints
          </span>
          <span className="fact">
            <b>{head.valid}</b> valid · <b>{head.outdated}</b> outdated · <b>{head.orphaned}</b> orphaned
          </span>
          {pending ? (
            <span className="fact pending">
              <b>{pending}</b> {pending === 1 ? 'event' : 'events'} not committed
            </span>
          ) : null}
          {hasMap(abs) ? (
            <a className="btn" href="/map">
              Access map
            </a>
          ) : (
            <span className="btn" aria-disabled="true" title="No tools/access-map/: ask the Agent to map the access of this project">
              Access map
            </span>
          )}
          <a className="btn" href="/history">
            History
          </a>
        </div>
      </header>
      {error && (
        <p className="note-box error" role="alert">
          {error} · showing the last state that could be read.
        </p>
      )}
      <form className="filters" method="get" action="/">
        {head.dimensions && <Select name="zone" label="Zone" value={filters.zone} options={zones(db).map(z => [z, z])} />}
        <Select name="tier" label="Tier" value={filters.tier} options={Object.entries(TIERS).map(([t, name]) => [t, `${t} · ${name}`])} />
        <Select name="signal" label="Signal" value={filters.signal} options={SIGNAL_IDS.map(s => [s, s])} />
        <Select name="state" label="Verdict" value={filters.state} options={STATES.map(s => [s, s])} />
        <label>
          Path
          <input type="search" name="q" defaultValue={filters.q} placeholder="/api/" />
        </label>
        <label className="choice">
          <input type="checkbox" name="view" value="reviewed" defaultChecked={filters.view === 'reviewed'} /> reviewed
        </label>
        <button type="submit" className="btn">
          Filter
        </button>
        {FILTERS.some(k => filters[k]) && (
          <a className="btn" href="/">
            Clear
          </a>
        )}
      </form>
      <div className="layout">
        <section aria-label={filters.view === 'reviewed' ? 'Reviewed' : 'Review Queue'} className="queue">
          <form className="selection" method="get" action="/">
            <span className="muted">
              {rows.length} {filters.view === 'reviewed' ? 'reviewed endpoints' : 'rows in the queue'}
            </span>
            {Object.entries(filters).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <button type="submit" name="bulk" value="1" className="btn" disabled={!rows.length}>
              Review selection
            </button>
          </form>
          {tiers.map(tier => (
            <section key={tier} aria-label={`Tier ${tier}`} className="tier">
              <h2>
                Tier {tier} · {TIERS[tier]} <span className="muted">({rows.filter(r => r.tier === tier).length})</span>
              </h2>
              <table className="rows">
                <tbody>
                  {rows
                    .filter(r => r.tier === tier)
                    .map(r => (
                      <QueueRow key={keyText(r.key)} r={r} zone={head.dimensions} current={open} link={href(filters, keyText(r.key))} />
                    ))}
                </tbody>
              </table>
            </section>
          ))}
        </section>
        {bulk && <BulkPanel selection={rows} filters={filterText} close={href(filters)} />}
        {selected && (
          <EndpointPanel
            row={selected}
            siblings={selected.siblings.flatMap(k => row(db, keyText(k)) ?? [])}
            history={history(db, keyText(selected.key))}
            candidates={candidates(selected, orphans(db))}
            project={abs}
            filters={filterText}
            close={href(filters)}
          />
        )}
      </div>
    </main>
  );
}

const QueueRow = ({ r, zone, current, link }: { r: Projected; zone: boolean; current: string | null; link: string }) => (
  <tr aria-current={current === keyText(r.key) ? 'true' : undefined} data-key={keyText(r.key)}>
    <td>
      <span className="m">{r.head ? `${r.method},HEAD` : r.method}</span>
    </td>
    <td>
      <a href={link} className="path">
        {r.path}
      </a>
    </td>
    {zone && <td className="muted">{Object.values(r.dimensions).join(', ')}</td>}
    <td>
      <code>
        {r.authentication.value}/{r.authorization.value}
      </code>
    </td>
    <td className="badges">
      {r.signals.map(s => (
        <span key={s.id} className={s.id === 'agent' ? 'chip l-role' : 'chip l-unknown'} title={s.text}>
          {s.id}
        </span>
      ))}
    </td>
    <td className="muted">{r.state === 'none' ? '' : r.state === 'valid' ? r.verdict?.verdict : r.state}</td>
  </tr>
);
