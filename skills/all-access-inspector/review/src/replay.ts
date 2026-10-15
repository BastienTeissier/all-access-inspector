// Replay: the Review Log read against the current inventory, into one row per endpoint and the orphaned Verdicts.

import { type Endpoint, type Folded, type Inventory, type Key, type Seen, foldHead, inside, keyOf, keyText } from './inventory.ts';
import type { Logged, Reviewed, SignalRaised, Triaged } from './log.ts';
import { type Signal, siblings, signals } from './signals.ts';
import { tierOf } from './tiers.ts';

export interface Row extends Folded {
  key: Key;
  inside: boolean | null;
  verdict: Reviewed | null;
  state: 'none' | 'valid' | 'outdated';
  moot: boolean; // reviewed while outside its expected access, inside now
  agent: SignalRaised | Triaged | null;
  signals: Signal[];
  tier: number;
}

export interface Orphan {
  key: Key;
  verdict: Reviewed;
}

const AXES = ['authentication', 'authorization'] as const;
const FIELDS = ['value', 'layer', 'raw', 'rule'] as const;

/**
 * Whether what was reviewed no longer holds. Inside its expected access (or with none), only a change of value counts;
 * outside it, any change to the check that decided it.
 */
export const changed = (seen: Seen, e: Endpoint, insideNow: boolean | null): boolean =>
  AXES.some(axis => (insideNow === false ? FIELDS : (['value'] as const)).some(f => seen[axis][f] !== e[axis][f]));

const later = <T extends Logged>(a: T | undefined, b: T): T => (!a || b.at > a.at || (b.at === a.at && b.line > a.line) ? b : a);

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
