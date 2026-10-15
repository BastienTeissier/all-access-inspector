// Deterministic Signals: reasons to look at an endpoint first, computed from the inventory alone.

import { type ExpectedAccess, type Folded, SAFE_METHODS, classification, isUnknown } from './inventory.ts';
import type { SignalRaised, Triaged } from './log.ts';

/** Every Signal id, in tier order. */
export const SIGNAL_IDS = ['outside_expected', 'unknown', 'sibling', 'open_write', 'agent', 'id_without_authz', 'open_read'] as const;

export interface Signal {
  id: (typeof SIGNAL_IDS)[number];
  text: string;
}

/** What `signals` reads of a row: the endpoint, its zone check and its agent event. */
export interface Signalled extends Folded {
  inside: boolean | null;
  agent: SignalRaised | Triaged | null;
}

const open = (e: Folded) => e.authentication.value === 'anonymous' || e.authentication.value === 'optional';

/** The path with a trailing `/`, so `/a` and `/a/` are one resource. */
const slashed = (path: string) => path.replace(/\/?$/, '/');

/** The path one trailing `{param}` segment up: `/observations/{id}/` → `/observations/`; null when it ends in a literal. */
const parent = (path: string) => (/\{[^}/]+\}\/?$/.test(path) ? slashed(path.replace(/\{[^}/]+\}\/?$/, '')) : null);

/**
 * Same resource, different access, and not one rule deciding both (IsAuthenticatedOrReadOnly splits by method on purpose).
 * OPTIONS answers metadata and an unknown is already ranked higher: neither is compared.
 */
const inconsistent = (a: Folded, b: Folded) =>
  a.method !== 'OPTIONS' &&
  b.method !== 'OPTIONS' &&
  !isUnknown(a) &&
  !isUnknown(b) &&
  (a.authentication.value !== b.authentication.value || a.authorization.value !== b.authorization.value) &&
  !(a.authentication.rule === b.authentication.rule && a.authorization.rule === b.authorization.rule);

const index = <T>(rows: T[], key: (row: T) => string | null): Map<string, T[]> => {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k !== null) map.set(k, [...(map.get(k) ?? []), row]);
  }
  return map;
};

/**
 * For each row, the rows of the same resource whose access differs: same path, the path one `{param}` up or down,
 * or the same project handler (`file:line`). A framework handler (a dotted name such as RedirectView) serves unrelated
 * paths, so it relates nothing; two peer `{param}` paths under one parent are not related either.
 */
export const siblings = <T extends Folded>(rows: T[]): Map<T, T[]> => {
  const byPath = index(rows, r => slashed(r.path));
  const byParent = index(rows, r => parent(r.path));
  const byHandler = index(rows, r => (/:\d+$/.test(r.handler) ? r.handler : null));
  const found = new Map<T, T[]>();
  for (const row of rows) {
    const up = parent(row.path);
    const related = new Set([
      ...(byPath.get(slashed(row.path)) ?? []),
      ...(up === null ? [] : (byPath.get(up) ?? [])),
      ...(byParent.get(slashed(row.path)) ?? []),
      ...(byHandler.get(row.handler) ?? []),
    ]);
    const differing = [...related].filter(other => other !== row && inconsistent(row, other));
    if (differing.length) found.set(row, differing);
  }
  return found;
};

const outsideText = (row: Folded, expected: ExpectedAccess): string => {
  const off: string[] = [];
  for (const [dimension, value] of Object.entries(row.dimensions)) {
    const x = expected[dimension]?.[value];
    if (!x) continue;
    if (!x.authentication.includes(row.authentication.value)) off.push(`authentication ${row.authentication.value}, ${value} expects ${x.authentication.join(' or ')}`);
    if (!x.authorization.includes(row.authorization.value)) off.push(`authorization ${row.authorization.value}, ${value} expects ${x.authorization.join(' or ')}`);
  }
  return off.join('; ');
};

/** Every Signal of a row, listed in tier order for reading; the tier itself does not depend on that order. */
export const signals = (row: Signalled, siblingRows: Folded[], expected: ExpectedAccess): Signal[] => {
  const out: Signal[] = [];
  if (row.inside === false) out.push({ id: 'outside_expected', text: outsideText(row, expected) });
  if (isUnknown(row)) out.push({ id: 'unknown', text: row.unknown_reason ?? 'no reason recorded' });
  const sibling = siblingRows[0];
  if (sibling) out.push({ id: 'sibling', text: `${sibling.method} ${sibling.path} is ${classification(sibling)}` });
  if (open(row) && !SAFE_METHODS.has(row.method)) out.push({ id: 'open_write', text: `${row.authentication.value} ${row.method}` });
  if (row.agent?.event === 'signal_raised') out.push({ id: 'agent', text: `${row.agent.reason} (${row.agent.evidence})` });
  if (row.authentication.value === 'required' && row.authorization.value === 'none' && row.path.includes('{'))
    out.push({ id: 'id_without_authz', text: 'path parameter, no authorization rule' });
  if (open(row) && SAFE_METHODS.has(row.method)) out.push({ id: 'open_read', text: `${row.authentication.value} ${row.method}` });
  return out;
};
