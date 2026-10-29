// Replay: the Review Log read against the current inventory, into one row per endpoint and the orphaned Verdicts.

import { type Endpoint, type Folded, type Inventory, type Key, SEEN_FIELDS, type Seen, foldHead, inside, keyOf, keyText } from './inventory.ts';
import type { CellKey, CellSeen, CellSignal, CellTriaged, Decided, Logged, LoggedCell, Reviewed, SignalRaised, Triaged } from './log.ts';
import { type Signal, siblings, signals } from './signals.ts';
import { tierOf } from './tiers.ts';

export interface Row extends Folded {
  key: Key;
  inside: boolean | null;
  verdict: Reviewed | null;
  state: 'none' | 'valid' | 'outdated';
  expired: boolean; // outdated because an `accepted` Verdict's `until` has passed
  moot: boolean; // reviewed while outside its expected access, inside now
  agent: SignalRaised | Triaged | null;
  signals: Signal[];
  tier: number;
}

export interface Orphan {
  key: Key;
  verdict: Reviewed;
}

/** The latest Capability Decision on a cell, against the cell as the map computes it now. */
export interface Decision {
  key: CellKey;
  decision: Decided;
  state: 'valid' | 'outdated' | 'orphaned';
  expired: boolean;
}

/** The latest agent event on a cell whose cell has not changed since. */
export interface CellAgent {
  key: CellKey;
  event: CellSignal | CellTriaged;
}

/** The cells of the access map, keyed by cellText, as the map computes them now; the review knows nothing else of cells. */
export type Cells = Map<string, CellSeen>;

export const cellText = (key: CellKey): string => JSON.stringify(key);

const AXES = ['authentication', 'authorization'] as const;

/**
 * Whether what was reviewed no longer holds. Inside its expected access (or with none), only a change of value counts;
 * outside it, any change to the check that decided it.
 */
export const changed = (seen: Seen, e: Endpoint, insideNow: boolean | null): boolean =>
  AXES.some(axis => (insideNow === false ? SEEN_FIELDS : (['value'] as const)).some(f => seen[axis][f] !== e[axis][f]));

const keys = (xs: Key[]): string => xs.map(keyText).sort().join('\n');

/** Whether the cell is no longer what the event saw: another state, or another set of reached or missed endpoints. */
export const cellChanged = (seen: CellSeen, now: CellSeen): boolean =>
  seen.state !== now.state || keys(seen.reached) !== keys(now.reached) || keys(seen.missed) !== keys(now.missed);

const later = <T extends { at: string; line: number }>(a: T | undefined, b: T): T => (!a || b.at > a.at || (b.at === a.at && b.line > a.line) ? b : a);

/** The latest decision and agent event per cell; a decision on a cell that no longer exists is orphaned. */
export const decide = (cells: Cells, events: LoggedCell[], today: string): { decisions: Decision[]; agents: CellAgent[] } => {
  const decided = new Map<string, Decided & LoggedCell>();
  const agent = new Map<string, (CellSignal | CellTriaged) & LoggedCell>();
  for (const e of events) {
    const k = cellText(e.capability);
    if (e.event === 'decided') decided.set(k, later(decided.get(k), e));
    else agent.set(k, later(agent.get(k), e));
  }
  const decisions = [...decided.entries()].map(([k, decision]): Decision => {
    const now = cells.get(k);
    const expired = decision.verdict === 'accepted' && decision.until !== undefined && decision.until < today;
    const state = !now ? 'orphaned' : expired || cellChanged(decision.seen, now) ? 'outdated' : 'valid';
    return { key: decision.capability, decision, state, expired };
  });
  const agents = [...agent.entries()].flatMap(([k, event]) => {
    const now = cells.get(k);
    const settled = decisions.some(d => d.state === 'valid' && cellText(d.key) === k);
    return now && !settled && !cellChanged(event.seen, now) ? [{ key: event.capability, event }] : [];
  });
  return { decisions, agents };
};

/** `today` is YYYY-MM-DD; an `accepted` Verdict is outdated the day after its `until`. */
export const replay = (inventory: Inventory, events: Logged[], today: string): { rows: Row[]; orphans: Orphan[] } => {
  const expected = inventory.expected_access;
  const reviewed = new Map<string, Reviewed & Logged>();
  const agent = new Map<string, (SignalRaised | Triaged) & Logged>();
  for (const e of events) {
    const k = keyText(e.endpoint);
    if (e.event === 'reviewed') reviewed.set(k, later(reviewed.get(k), e));
    else agent.set(k, later(agent.get(k), e));
  }

  const rows: Row[] = foldHead(inventory.endpoints).map(e => {
    const key = keyOf(e);
    const now = inside(e, expected);
    const verdict = reviewed.get(keyText(key)) ?? null;
    const expired = verdict?.verdict === 'accepted' && verdict.until !== undefined && verdict.until < today;
    const state = !verdict ? 'none' : expired || changed(verdict.seen, e, now) ? 'outdated' : 'valid';
    const raised = agent.get(keyText(key));
    return {
      ...e,
      key,
      inside: now,
      verdict,
      state,
      expired,
      moot: state === 'valid' && verdict?.seen.inside === false && now === true,
      agent: raised && state !== 'valid' && !changed(raised.seen, e, now) ? raised : null,
      signals: [],
      tier: 0,
    };
  });

  const related = siblings(rows);
  for (const row of rows) {
    row.signals = signals(row, related.get(row) ?? [], expected);
    row.tier = tierOf(row);
  }

  const known = new Set(rows.flatMap(r => [keyText(r.key), ...(r.head ? [keyText(['HEAD', r.key[1], r.key[2]])] : [])]));
  const orphans = [...reviewed.entries()].filter(([k]) => !known.has(k)).map(([, verdict]) => ({ key: verdict.endpoint, verdict }));
  return { rows, orphans };
};
