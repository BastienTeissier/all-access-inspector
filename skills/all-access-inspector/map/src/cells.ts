// Capabilities and cells: per capability and role, whether the role passes, its scope, and on what basis.

import { type Key, keyText } from '../../review/src/inventory.ts';
import type { CellSeen, LoggedCell } from '../../review/src/log.ts';
import { type CellAgent, type Cells, type Decision, cellText, decide } from '../../review/src/replay.ts';
import { type MapEndpoint, weakest } from './join.ts';
import { type Reach, type Role, reach } from './roles.ts';
import type { Basis, Runtime } from './runtime.ts';
import type { Vocabulary } from './vocabulary.ts';

export interface Capability {
  id: string;
  name: string;
  sub: string | null;
  area: string;
  term: string | null;
  verb: 'read' | 'write';
  endpoints: string[][]; // [method, path] or [method, path, handler key], as written
  check: string;
  at: string | null;
  basis: Basis;
  reason: string | null;
}

export type CellState = 'pass' | 'partial' | 'no' | 'off' | 'open';

export interface Scope {
  id: string;
  label: string;
  at: string;
  basis: Basis;
}

export interface Cell {
  capability: string;
  role: string;
  state: CellState;
  scope: Scope | null;
  basis: Basis;
  seen: CellSeen;
  decision: Decision | null;
}

/** Extracted capabilities named or replaced by the vocabulary, then the hand-written ones. */
export const capabilityList = (runtime: Runtime, vocabulary: Vocabulary): Capability[] => {
  const written = vocabulary.capabilities.flatMap(c => ('id' in c ? [c] : []));
  const replaced = new Set(written.flatMap(c => c.replaces ?? []));
  const named = new Map(vocabulary.capabilities.flatMap(c => ('extends' in c ? [[c.extends, c] as const] : [])));
  const extracted = runtime.capabilities
    .filter(c => !replaced.has(c.id))
    .map((c): Capability => {
      const n = named.get(c.id);
      return { ...c, name: n?.name ?? c.id, sub: n?.sub ?? null, area: n?.area ?? c.area, reason: null };
    });
  const curated = written.map(
    (c): Capability => ({
      id: c.id,
      name: c.name,
      sub: c.sub ?? null,
      area: c.area,
      term: null,
      verb: c.verb,
      endpoints: c.endpoints,
      check: c.check,
      at: c.evidence[0]?.[0] ?? null,
      basis: 'curated',
      reason: c.reason,
    }),
  );
  return [...extracted, ...curated];
};

/** The map endpoints one capability lists; a HEAD is its GET's row; one with no handler matches every handler. */
export const endpointsOf = (cap: Capability, endpoints: MapEndpoint[]): { found: MapEndpoint[]; missing: string[][] } => {
  const found: MapEndpoint[] = [];
  const missing: string[][] = [];
  for (const listed of cap.endpoints) {
    const [method, path, handler] = listed;
    const m = method === 'HEAD' ? 'GET' : method;
    const hits = endpoints.filter(e => e.key[0] === m && e.key[1] === path && (handler === undefined || e.key[2] === handler));
    if (!hits.length) missing.push(listed);
    for (const e of hits) if (!found.includes(e)) found.push(e);
  }
  return { found, missing };
};

/** Cell state over the capability's endpoints, per plan §1. */
export const cellState = (reaches: Reach[]): CellState => {
  const yes = reaches.filter(r => r === 'yes').length;
  if (reaches.length && yes === reaches.length) return 'pass';
  if (reaches.length && reaches.every(r => r === 'off')) return 'off';
  if (!yes && !reaches.includes('unresolved')) return 'no';
  if (yes && reaches.some(r => r === 'no' || r === 'off')) return 'partial';
  return 'open';
};

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortKeys = (keys: Key[]): Key[] => [...keys].sort((a, b) => byText(keyText(a), keyText(b)));

/** The scope narrowing a capability for a role: a Map Rule's or the introspect's (`inferred`), else hand-written (`curated`).
 * The role's own scoped fact first, else the first role it includes that has one. */
const scopeOf = (runtime: Runtime, vocabulary: Vocabulary, capability: string, role: Role): Scope | null => {
  const scopeFor = (r: string) =>
    runtime.scoped.find(s => s.capability === capability && s.role === r)?.scope ??
    vocabulary.scoped?.find(s => s.capability === capability && s.role === r)?.scope;
  const id = [role.id, ...role.includes].map(scopeFor).find(Boolean);
  if (!id) return null;
  const fromRuntime = runtime.scopes.find(s => s.id === id);
  if (fromRuntime) return { ...fromRuntime, basis: weakest('inferred', fromRuntime.basis) };
  const fromVocabulary = vocabulary.scopes?.find(s => s.id === id);
  return fromVocabulary ? { id, label: fromVocabulary.label, at: fromVocabulary.at, basis: 'curated' } : null;
};

/** One cell: what the role reaches of the capability, as a decision fingerprints it. */
export const cell = (cap: Capability, role: Role, endpoints: MapEndpoint[], runtime: Runtime, vocabulary: Vocabulary): Omit<Cell, 'decision'> => {
  const reaches = endpoints.map(e => reach(e.who, role));
  const state = cellState(reaches);
  const scope = state === 'pass' || state === 'partial' ? scopeOf(runtime, vocabulary, cap.id, role) : null;
  const seen: CellSeen = {
    state,
    reached: sortKeys(endpoints.filter((_, i) => reaches[i] === 'yes').map(e => e.key)),
    missed: sortKeys(endpoints.filter((_, i) => reaches[i] === 'no' || reaches[i] === 'off').map(e => e.key)),
    who: Object.fromEntries(endpoints.map(e => [keyText(e.key), [e.who.kind, e.who.basis]])),
  };
  const basis = weakest(...endpoints.map(e => e.who.basis), ...(scope ? [scope.basis] : []));
  return { capability: cap.id, role: role.id, state, scope, basis, seen };
};

/** Every cell, its decision joined from the Review Log; decisions on cells that no longer exist are orphaned. */
export const cells = (
  caps: Capability[],
  roles: Role[],
  endpoints: MapEndpoint[],
  runtime: Runtime,
  vocabulary: Vocabulary,
  logged: LoggedCell[],
  today: string,
): { cells: Cell[]; orphans: Decision[]; agents: CellAgent[] } => {
  const computed = caps.flatMap(cap => {
    const found = endpointsOf(cap, endpoints).found;
    return roles.map(role => cell(cap, role, found, runtime, vocabulary));
  });
  const current: Cells = new Map(computed.map(c => [cellText([c.capability, c.role]), c.seen]));
  const { decisions, agents } = decide(current, logged, today);
  const byCell = new Map(decisions.map(d => [cellText(d.key), d]));
  return {
    cells: computed.map(c => ({ ...c, decision: byCell.get(cellText([c.capability, c.role])) ?? null })),
    orphans: decisions.filter(d => d.state === 'orphaned'),
    agents,
  };
};
