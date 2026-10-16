// The Review Log as History shows it: one group per batch, a single event (no batch) as a group of its own; and the
// orphaned Verdicts an unreviewed endpoint may have been.

import { handlerFile } from '../../../skills/all-access-inspector/review/src/inventory.ts';
import type { Logged } from '../../../skills/all-access-inspector/review/src/log.ts';
import type { Orphan, Row } from '../../../skills/all-access-inspector/review/src/replay.ts';

/** One event in a line: the Verdict and its reason, or the Agent's read. */
export const eventText = (e: Logged): string =>
  e.event === 'reviewed'
    ? `${e.verdict}${e.severity ? ` (${e.severity})` : ''}: ${e.reason}`
    : e.event === 'signal_raised'
      ? `signal: ${e.reason} (${e.evidence})`
      : 'triaged: no signal';

export interface Group {
  batch: string | null;
  by: string;
  /** Its newest event's. */
  at: string;
  events: Logged[];
}

/** `events` newest first, grouped by batch in the order their newest event comes. */
export const groups = (events: Logged[]): Group[] => {
  const byBatch = new Map<string, Group>();
  const out: Group[] = [];
  for (const e of events) {
    const group = e.batch ? byBatch.get(e.batch) : undefined;
    if (group) {
      group.events.push(e);
      continue;
    }
    const created = { batch: e.batch, by: e.by, at: e.at, events: [e] };
    if (e.batch) byBatch.set(e.batch, created);
    out.push(created);
  }
  return out;
};

/** The group's events an endpoint at a time, as the queue counts them: a HEAD reviewed with its GET is not one more. */
export const endpoints = (group: Group): Logged[] => {
  const gets = new Set(group.events.filter(e => e.endpoint[0] === 'GET').map(e => `${e.endpoint[1]} ${e.endpoint[2]}`));
  return group.events.filter(e => e.endpoint[0] !== 'HEAD' || !gets.has(`${e.endpoint[1]} ${e.endpoint[2]}`));
};

/** What a group did, an endpoint at a time, e.g. `safe ×378` or `signal_raised ×2 · triaged ×5`. */
export const kinds = (group: Group): string => {
  const counts = new Map<string, number>();
  for (const e of endpoints(group)) {
    const kind = e.event === 'reviewed' ? e.verdict : e.event;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts].map(([kind, n]) => (n === 1 ? kind : `${kind} ×${n}`)).join(' · ');
};

/** The reason every event of the group shares, or null when they differ or have none. */
export const reason = (group: Group): string | null => {
  const reasons = new Set(group.events.map(e => ('reason' in e ? e.reason : null)));
  const [only] = reasons;
  return reasons.size === 1 && only ? only : null;
};

/**
 * The orphans an endpoint without a valid Verdict may have been, renamed or moved: same path or same handler file. Only
 * proposed: copying a reason writes a new Verdict on the endpoint, the orphan stays as it is.
 */
export const candidates = (row: Row, lost: Orphan[]): Orphan[] => {
  if (row.state === 'valid') return [];
  const here = handlerFile(row.handler);
  return lost.filter(o => o.key[1] === row.path || (here !== null && handlerFile(o.verdict.seen.handler) === here));
};
