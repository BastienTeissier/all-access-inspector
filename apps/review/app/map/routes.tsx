// The Routes tab: every endpoint with the checks it passes through, filtered by URL parameters as the queue is.

import type { PageData, PageEndpoint } from '../../../../skills/all-access-inspector/map/src/data.ts';
import { keyText } from '../../../../skills/all-access-inspector/review/src/inventory.ts';
import { BASIS, Who } from './labels.tsx';

export const ROUTE_FILTERS = ['domain', 'q', 'role', 'write', 'sig', 'out', 'guess', 'cap'] as const;

const domainOf = (e: PageEndpoint) => e.domain ?? '(no domain)';

/** The endpoints of a capability: the same for every role, so read from any of its cells. */
const capEndpoints = (data: PageData, cap: string): Set<string> => {
  const c = data.cells.find(x => x.capability === cap);
  return new Set(c ? [...c.seen.reached, ...c.seen.missed].map(keyText) : []);
};

const matches = (e: PageEndpoint, p: URLSearchParams, inCap: Set<string> | null): boolean => {
  const q = p.get('q')?.toLowerCase();
  const role = p.get('role');
  if (p.get('domain') && domainOf(e) !== p.get('domain')) return false;
  if (inCap && !inCap.has(keyText(e.key))) return false;
  if (p.get('write') && !e.write) return false;
  if (p.get('sig') && !e.signals.length) return false;
  if (p.get('out') && e.inside !== false) return false;
  if (p.get('guess') && ['extracted', 'rule'].includes(e.who.basis)) return false;
  if (role && e.reach[role] !== 'yes') return false;
  if (q) {
    const hay = [e.path, e.handler, e.method, ...e.permissions, ...e.layers.map(l => `${l.title} ${l.at ?? ''} ${l.text}`)].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
};

const Check = ({ name, label, params }: { name: string; label: string; params: URLSearchParams }) => (
  <label className="choice">
    <input type="checkbox" name={name} value="1" defaultChecked={Boolean(params.get(name))} /> {label}
  </label>
);

export const Routes = ({ data, params }: { data: PageData; params: URLSearchParams }) => {
  const cap = params.get('cap');
  const caps = data.areas.flatMap(a => a.capabilities);
  const byCap = new Map(caps.map(c => [c.id, capEndpoints(data, c.id)]));
  const list = data.endpoints.filter(e => matches(e, params, cap ? (byCap.get(cap) ?? new Set()) : null));
  const domains = [...new Set(data.endpoints.map(domainOf))];
  const capsOf = (e: PageEndpoint) => caps.filter(c => byCap.get(c.id)?.has(keyText(e.key)));
  const domainHref = (d: string | null) => {
    const next = new URLSearchParams(params);
    if (d) next.set('domain', d);
    else next.delete('domain');
    return `/map?${next.toString()}`;
  };
  return (
    <section aria-label="Routes">
      <form className="filters" method="get" action="/map">
        <input type="hidden" name="tab" value="routes" />
        {params.get('domain') && <input type="hidden" name="domain" value={params.get('domain')!} />}
        {cap && <input type="hidden" name="cap" value={cap} />}
        <label>
          Search
          <input type="search" name="q" defaultValue={params.get('q') ?? ''} placeholder="Path, handler, permission, file…" />
        </label>
        <label>
          Reachable by
          <select name="role" defaultValue={params.get('role') ?? ''}>
            <option value="">any role</option>
            {data.roles.map(r => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <Check name="write" label="Writes only" params={params} />
        <Check name="sig" label="Has signals" params={params} />
        <Check name="out" label="Outside expected" params={params} />
        <Check name="guess" label="Not read from code" params={params} />
        <button type="submit" className="btn">
          Filter
        </button>
        {ROUTE_FILTERS.some(k => params.get(k)) && (
          <a className="btn" href="/map?tab=routes">
            Clear
          </a>
        )}
      </form>
      <nav className="legend" aria-label="Domains">
        <a className="btn" href={domainHref(null)} aria-current={!params.get('domain')}>
          All domains ({data.endpoints.length})
        </a>
        {domains.map(d => (
          <a key={d} className="btn" href={domainHref(d)} aria-current={params.get('domain') === d}>
            {d} ({data.endpoints.filter(e => domainOf(e) === d).length})
          </a>
        ))}
      </nav>
      <p className="muted">
        {list.length} of {data.endpoints.length} routes
        {cap && ` · capability ${caps.find(c => c.id === cap)?.name ?? cap}`}
      </p>
      <ul className="routes">
        {list.map(e => (
          <li key={keyText(e.key)}>
            <details open={Boolean(cap)}>
              <summary>
                <span className="m">{e.method}</span> <span className="path">{e.path}</span> <Who who={e.who} roles={data.roles} />
                {e.inside === false && <span className="chip l-unknown">outside</span>}
                {e.signals.length > 0 && <span className="chip l-open">⚠ {e.signals.length}</span>}
                <span className="muted"> T{e.tier}</span>
              </summary>
              <p>
                Who can pass: <b>{BASIS[e.who.basis]}.</b> {e.who.how} · handler <code>{e.handler}</code> ·{' '}
                <a href={`/?e=${encodeURIComponent(keyText(e.key))}`}>Open in the Review Queue</a>
              </p>
              <ol className="chain">
                {e.layers.map((l, i) => (
                  <li key={i}>
                    <b>{l.kind}</b> {l.title}
                    {l.value && <span className="muted"> · {l.value}</span>} <span className="muted">{l.text}</span> {l.at && <code>{l.at}</code>}{' '}
                    <span className="muted">({l.source})</span>
                  </li>
                ))}
              </ol>
              <p>
                Capabilities:{' '}
                {capsOf(e).length
                  ? capsOf(e).map(c => (
                      <a key={c.id} className="btn" href={`/map?tab=routes&cap=${encodeURIComponent(c.id)}`}>
                        {c.name}
                      </a>
                    ))
                  : 'behind no capability.'}
              </p>
            </details>
          </li>
        ))}
      </ul>
      {!list.length && <p className="muted">No route matches these filters.</p>}
    </section>
  );
};
