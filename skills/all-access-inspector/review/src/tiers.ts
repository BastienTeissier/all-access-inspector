// The Review Queue: every endpoint without a valid Verdict, by its highest tier, then path and method.

import type { Signal } from './signals.ts';

export const TIERS: Record<number, string> = {
  1: 'open finding',
  2: 'outdated verdict',
  3: 'outside its expected access',
  4: 'unknown',
  5: 'sibling inconsistency',
  6: 'anyone can write',
  7: 'agent signal',
  8: 'path parameter, no authorization rule',
  9: 'anyone can read',
  10: 'signed in, no authorization rule',
  11: 'authorization rule',
};

const SIGNAL_TIER: Record<Signal['id'], number> = {
  outside_expected: 3,
  unknown: 4,
  sibling: 5,
  open_write: 6,
  agent: 7,
  id_without_authz: 8,
  open_read: 9,
};

export interface Tiered {
  method: string;
  path: string;
  authorization: { value: string };
  state: 'none' | 'valid' | 'outdated';
  verdict: { verdict: string } | null;
  signals: Signal[];
}

export const tierOf = (row: Tiered): number => {
  if (row.state === 'valid' && row.verdict?.verdict === 'finding') return 1;
  if (row.state === 'outdated') return 2;
  const fallback = row.authorization.value === 'rule' ? 11 : 10;
  return Math.min(fallback, ...row.signals.map(s => SIGNAL_TIER[s.id]));
};

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Rows still needing a human: no valid `safe` or `accepted` Verdict. */
export const queue = <T extends Tiered & { tier: number }>(rows: T[]): T[] =>
  rows
    .filter(r => !(r.state === 'valid' && r.verdict?.verdict !== 'finding'))
    .sort((a, b) => a.tier - b.tier || byCodePoint(a.path, b.path) || byCodePoint(a.method, b.method));
