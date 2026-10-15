// Deterministic Signals: reasons to look at an endpoint first, computed from the inventory alone.

import { type ExpectedAccess, type Folded, SAFE_METHODS, classification, isUnknown } from './inventory.ts';
import type { SignalRaised, Triaged } from './log.ts';

export interface Signal {
  id: 'outside_expected' | 'unknown' | 'sibling' | 'open_write' | 'agent' | 'id_without_authz' | 'open_read';
  text: string;
}

/** What `signals` reads of a row: the endpoint, its zone check and its agent event. */
export interface Signalled extends Folded {
  inside: boolean | null;
  agent: SignalRaised | Triaged | null;
}

const open = (e: Folded) => e.authentication.value === 'anonymous' || e.authentication.value === 'optional';

/** The path without its last `{param}` segment, always ending in `/`: `/observations/{id}/` and `/observations/` share it. */
const stem = (path: string) => path.replace(/\{[^}/]+\}\/?$/, '').replace(/\/?$/, '/');

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

/**
 * For each row, the rows of the same resource whose access differs: same project handler (`file:line`), or same path stem.
 * A framework handler (a dotted name such as RedirectView) is shared by unrelated paths, so it groups nothing.
 */
export const siblings = <T extends Folded>(rows: T[]): Map<T, T[]> => {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const keys = [`path ${stem(row.path)}`, ...(/:\d+$/.test(row.handler) ? [`handler ${row.handler}`] : [])];
    for (const group of keys) {
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(row);
    }
  }
  const found = new Map<T, T[]>();
  for (const group of groups.values()) {
    for (const row of group) {
      for (const other of group) {
        if (other === row || !inconsistent(row, other)) continue;
        const list = found.get(row) ?? [];
        if (!list.includes(other)) list.push(other);
        found.set(row, list);
      }
    }
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

/** Every Signal of a row, in tier order. */
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
