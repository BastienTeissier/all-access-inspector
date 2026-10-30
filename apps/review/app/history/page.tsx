// History: who decided what and why, one group per batch, newest first; and the Verdicts and Decisions whose endpoint or cell is gone.

import { basename } from 'node:path';

import { projectDir } from '../../lib/filters.ts';
import { type Group, endpoints, eventText, groups, kinds, orphanedDecisions, page, reason } from '../../lib/history.ts';
import { accessMap, events, hasMap, orphans, project } from '../../lib/projection.ts';

export const dynamic = 'force-dynamic';

/** An Agent run is named by its model, a person by their email. */
const author = (by: string) => (by.startsWith('agent:') ? `agent · ${by.slice('agent:'.length)}` : by);

const GroupItem = ({ group }: { group: Group }) => {
  const shared = reason(group);
  const n = endpoints(group).length;
  const count = `${n} ${group.events.some(e => 'endpoint' in e) ? 'endpoint' : 'cell'}${n === 1 ? '' : 's'}`;
  return (
    <li className="group">
      <details>
        <summary>
          <b>{author(group.by)}</b> · <time dateTime={group.at}>{group.at.replace('T', ' ').replace('Z', '')}</time> · {kinds(group)} · {count}
          {shared && <span className="muted"> · {shared}</span>}
        </summary>
        <ul>
          {group.events.map(e => (
            <li key={e.line}>
              {'endpoint' in e ? (
                <>
                  <span className="m">{e.endpoint[0]}</span> <span className="path">{e.endpoint[1]}</span>
                </>
              ) : (
                <a href={`/map?tab=roles&cap=${encodeURIComponent(e.capability[0])}&role=${encodeURIComponent(e.capability[1])}`}>
                  {e.capability[0]} for {e.capability[1]}
                </a>
              )}{' '}
              <span className="muted">{shared ? (e.event === 'reviewed' || e.event === 'decided' ? e.verdict : e.event) : eventText(e)}</span>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
};

export default async function History({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const given = (await searchParams).page;
  const dir = projectDir();
  const { db, error, project: abs } = project(dir);
  if (!db)
    return (
      <main className="wrap">
        <h1>Cannot review {dir}</h1>
        <p className="note-box error">{error}</p>
      </main>
    );
  const lost = orphans(db);
  const all = events(db);
  const shown = page(groups(all), typeof given === 'string' ? given : null);
  const cells = hasMap(abs) ? accessMap(abs).data?.cells : undefined;
  const lostDecisions = cells ? orphanedDecisions(all, cells) : [];
  return (
    <main className="wrap">
      <header className="top">
        <div>
          <div className="brand">
            <span className="dot" /> access review
          </div>
          <h1>{basename(abs)} · History</h1>
        </div>
        <a className="btn" href="/">
          Review Queue
        </a>
      </header>
      {error && (
        <p className="note-box error" role="alert">
          {error} · showing the last state that could be read.
        </p>
      )}
      <section aria-label="Batches">
        <h2>Events</h2>
        <ol className="groups">
          {shown.groups.map(g => (
            <GroupItem key={g.batch ?? `line-${g.events[0]!.line}`} group={g} />
          ))}
        </ol>
        {(shown.n > 0 || shown.older) && (
          <nav className="pages" aria-label="Pages">
            {shown.n > 0 && (
              <a className="btn" href={shown.n === 1 ? '/history' : `/history?page=${shown.n - 1}`}>
                Newer
              </a>
            )}
            {shown.older && (
              <a className="btn" href={`/history?page=${shown.n + 1}`}>
                Older
              </a>
            )}
          </nav>
        )}
      </section>
      <section aria-label="Orphaned verdicts">
        <h2>Orphaned verdicts ({lost.length})</h2>
        {lost.length ? (
          <table className="rows">
            <tbody>
              {lost.map(o => (
                <tr key={JSON.stringify(o.key)}>
                  <td>
                    <span className="m">{o.key[0]}</span>
                  </td>
                  <td className="path">{o.key[1]}</td>
                  <td className="muted">{o.key[2]}</td>
                  <td>{o.verdict.verdict}</td>
                  <td>{o.verdict.reason}</td>
                  <td className="muted">{o.verdict.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Every Verdict names an endpoint of the inventory.</p>
        )}
      </section>
      {cells && (
        <section aria-label="Orphaned decisions">
          <h2>Orphaned decisions ({lostDecisions.length})</h2>
          {lostDecisions.length ? (
            <table className="rows">
              <tbody>
                {lostDecisions.map(d => (
                  <tr key={d.line}>
                    <td>{d.capability[0]}</td>
                    <td>{d.capability[1]}</td>
                    <td>{d.event === 'decided' && d.verdict}</td>
                    <td>{d.event === 'decided' && d.reason}</td>
                    <td className="muted">{d.by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Every Decision names a cell of the access map.</p>
          )}
        </section>
      )}
    </main>
  );
}
