// The access map in the review app (UF18): the static page's four tabs, built from the same data, the tab and the
// filters as URL parameters; a cell opens its panel and its decision form.

import { basename } from 'node:path';

import type { PageData } from '../../../../skills/all-access-inspector/map/src/data.ts';
import { keyText } from '../../../../skills/all-access-inspector/review/src/inventory.ts';
import { projectDir } from '../../lib/filters.ts';
import { accessMap, cellHistory, hasMap, project, uncommitted } from '../../lib/projection.ts';
import { CellPanel } from './cell-panel.tsx';
import { BASIS, KINDS, STATE, StateChip, cellHref } from './labels.tsx';
import { Routes } from './routes.tsx';

export const dynamic = 'force-dynamic';

const TABS: [string, string][] = [
  ['alerts', 'Alerts'],
  ['roles', 'Roles'],
  ['routes', 'Routes'],
  ['method', "How it's built"],
];

const Alerts = ({ data }: { data: PageData }) => {
  const kinds = Object.keys(KINDS).filter(kind => data.alerts.some(a => a.kind === kind));
  if (!kinds.length) return <p className="muted">Nothing to look at.</p>;
  return (
    <section aria-label="Alerts" className="map-alerts">
      {kinds.map((kind, i) => {
        const list = data.alerts.filter(a => a.kind === kind);
        return (
          <details key={kind} className="group" open={i === 0} aria-label={KINDS[kind]}>
            <summary>
              <b>{KINDS[kind]}</b> <span className="muted">{list.length}</span>
            </summary>
            <ul>
              {list.map(a => (
                <li key={`${a.text} ${a.label}`}>
                  <a href={a.cell ? cellHref(a.cell[0], a.cell[1]) : `/?e=${encodeURIComponent(keyText(a.endpoint!))}`}>{a.text}</a>{' '}
                  <span className="muted">{a.label}</span>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </section>
  );
};

const Matrix = ({ data, cap, role }: { data: PageData; cap: string | null; role: string | null }) => {
  const cells = new Map(data.cells.map(v => [`${v.capability} ${v.role}`, v]));
  return (
    <div className="matrix-scroll">
      <table className="matrix">
        <thead>
          <tr>
            <th className="cap">Capability</th>
            {data.roles.map(r => (
              <th key={r.id} scope="col" title={BASIS[r.basis]}>
                {r.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.areas.map(a => [
            <tr key={a.id} className="area">
              <th colSpan={data.roles.length + 1}>
                {a.name} <span className="muted">{a.capabilities.length} capabilities</span>
              </th>
            </tr>,
            ...a.capabilities.map(c => (
              <tr key={`${a.id} ${c.id}`}>
                <td className="cap">
                  {c.name} <span className={`verb ${c.verb}`}>{c.verb}</span>
                  {c.sub && <div className="muted">{c.sub}</div>}
                </td>
                {data.roles.map(r => {
                  const v = cells.get(`${c.id} ${r.id}`);
                  if (!v) return <td key={r.id} />;
                  const d = v.decision;
                  const label = `${c.name}, ${r.name}: ${STATE[v.state]?.[1]}${v.scope ? `, ${v.scope.label}` : ''}, ${BASIS[v.basis]}${d ? `, decided ${d.verdict}${d.state === 'outdated' ? ' (outdated)' : ''}` : ''}`;
                  return (
                    <td key={r.id} className="cell">
                      <a href={cellHref(c.id, r.id)} data-cap={c.id} data-role={r.id} aria-label={label} aria-current={cap === c.id && role === r.id ? 'true' : undefined}>
                        <StateChip state={v.state} basis={v.basis} />
                        {v.scope && <span className="muted scope">{v.scope.label}</span>}
                        {d && <span className={`mark ${d.state === 'outdated' ? 'outdated' : d.verdict === 'finding' ? 'finding' : ''}`} />}
                      </a>
                    </td>
                  );
                })}
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </div>
  );
};

const Method = ({ data }: { data: PageData }) => {
  const m = data.method;
  const counts: [number, string][] = [
    [m.rows, 'review rows (HEAD folded into GET)'],
    [m.rules, 'Recognition Rules'],
    [m.permissions, 'permissions'],
    [m.grants, 'grants of a permission to a role'],
    [m.anchors, 'anchored file:line references'],
    [m.route_checks, 'hand-written in-handler checks'],
  ];
  return (
    <section aria-label="How it's built" className="method">
      <h2>What the map is built from</h2>
      <p>
        The inventory lists every endpoint the {data.project.stack} app mounts; the review log adds tiers, signals, verdicts and decisions; the stack's
        Map Introspect reads what only the running app knows; the vocabulary names areas, capabilities and roles by hand.
      </p>
      <ul className="facts">
        {counts.map(([n, text]) => (
          <li key={text} className="fact">
            <b>{n}</b> {text}
          </li>
        ))}
      </ul>
      <h2>Capabilities, by basis</h2>
      <ul className="facts">
        {Object.entries(m.capabilities).map(([b, n]) => (
          <li key={b} className="fact">
            <b>{n}</b> {BASIS[b] ?? b}
          </li>
        ))}
      </ul>
      <h2>Map Introspect</h2>
      {m.runtime ? (
        <>
          <p>{m.runtime.reads}</p>
          <ul>
            {m.runtime.holds.map(h => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <h3>Heuristics (≈)</h3>
          <ul>{m.runtime.heuristics.length ? m.runtime.heuristics.map(h => <li key={h}>{h}</li>) : <li>None.</li>}</ul>
          <pre>{m.runtime.command}</pre>
        </>
      ) : (
        <p>{m.runtime_note ?? 'No Map Introspect for this stack: the map rests on the inventory and the vocabulary.'}</p>
      )}
    </section>
  );
};

export default async function AccessMap({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams(Object.entries(await searchParams).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])));
  const dir = projectDir();
  const { db, project: abs } = project(dir);
  if (!hasMap(abs))
    return (
      <main className="wrap">
        <h1>No access map for {basename(abs)}</h1>
        <p className="note-box">
          <code>tools/access-map/</code> is missing: ask the Agent to map the access of this project (§ Map of the skill), then reload.
        </p>
      </main>
    );
  const { data, problems, error } = accessMap(abs);
  const tab = TABS.some(([t]) => t === params.get('tab')) ? params.get('tab')! : 'roles';
  const cap = params.get('cap');
  const role = params.get('role');
  const pending = uncommitted(abs);
  const panel = tab === 'roles' && data && cap && role && db;
  return (
    <main className={panel ? 'wrap with-panel' : 'wrap'}>
      <header className="top">
        <div>
          <div className="brand">
            <span className="dot" /> access map
          </div>
          <h1>Who can do what in {basename(abs)}</h1>
        </div>
        <div className="facts">
          {data && (
            <span className="fact">
              <b>{data.areas.reduce((n, a) => n + a.capabilities.length, 0)}</b> capabilities · <b>{data.coverage.covered}</b> of{' '}
              <b>{data.coverage.total}</b> endpoints behind one · <b>{data.roles.length}</b> roles
            </span>
          )}
          {pending ? (
            <span className="fact pending">
              <b>{pending}</b> {pending === 1 ? 'event' : 'events'} not committed
            </span>
          ) : null}
          <a className="btn" href="/">
            Review Queue
          </a>
          <a className="btn" href="/history">
            History
          </a>
        </div>
      </header>
      {error && (
        <p className="note-box error" role="alert">
          map check: {error}
          {data && ' · showing the last map that could be built.'}
        </p>
      )}
      {problems.length > 0 && (
        <details className="note-box" aria-label="map check">
          <summary>
            <code>map check</code> fails on {problems.length} problem{problems.length === 1 ? '' : 's'}
          </summary>
          <ul>
            {problems.map(p => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </details>
      )}
      {data && (
        <>
          <nav className="tabs" aria-label="Tabs">
            {TABS.map(([t, name]) => (
              <a key={t} href={`/map?tab=${t}`} aria-current={tab === t ? 'page' : undefined}>
                {name}
                {t === 'alerts' && (
                  <span className="cnt" id="alert-count">
                    {data.alerts.length || ''}
                  </span>
                )}
              </a>
            ))}
          </nav>
          <div className="layout">
            <div>
              {tab === 'alerts' && <Alerts data={data} />}
              {tab === 'roles' && <Matrix data={data} cap={cap} role={role} />}
              {tab === 'routes' && <Routes data={data} params={params} />}
              {tab === 'method' && <Method data={data} />}
            </div>
            {panel && <CellPanel data={data} cap={cap} role={role} history={cellHistory(db, [cap, role])} />}
          </div>
        </>
      )}
    </main>
  );
}
