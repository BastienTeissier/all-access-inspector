// The join: one map endpoint per review row, its check layers, who can pass and on what basis.

import type { Axis } from '../../review/src/inventory.ts';
import type { output } from '../../review/src/cli.ts';
import { BASES, type Basis, type Layer, type Runtime, type RuntimeEndpoint, type Who, indexRuntime } from './runtime.ts';
import type { Domain, Resource, RouteCheck, Vocabulary } from './vocabulary.ts';

export type StatusRow = ReturnType<typeof output>;

export interface MapEndpoint {
  key: [string, string, string];
  method: string; // GET+HEAD when the HEAD is folded into its GET
  path: string;
  handler: string;
  domain: string | null;
  resource: string | null;
  dimensions: Record<string, string>;
  authn: string;
  authz: string;
  tier: number;
  inside: boolean | null;
  signals: StatusRow['signals'];
  verdict: string | null;
  write: boolean;
  layers: Layer[];
  permissions: string[];
  grants: Record<string, { role: string; at: string }[]>;
  who: Who;
}

export class JoinError extends Error {}

const ruleName = (axis: Axis): string => (axis.rule ?? '').replace(/^recognition:/, '');

/** What an inventory axis says, as a badge basis: read from code, or from a reviewed Recognition Rule. */
export const fromAxis = (axis: Axis): { basis: Basis; how: string } =>
  (axis.rule ?? '').startsWith('builtin:')
    ? { basis: 'extracted', how: `Inventory: ${axis.raw ?? 'no check'}` }
    : { basis: 'rule', how: `Recognition rule ${ruleName(axis)} (${axis.evidence})` };

/** A badge takes the weakest basis of what it rests on. */
export const weakest = (...bases: Basis[]): Basis => bases.reduce((a, b) => (BASES.indexOf(b) > BASES.indexOf(a) ? b : a), 'extracted');

/** The vocabulary's domain for a path; none when the vocabulary defines no domains. */
export const domainOf = (path: string, domains: Domain[] | undefined): string | null => {
  if (!domains?.length) return null;
  const found = domains.find(d => (d.contains ?? []).some(s => path.includes(s)) || (d.prefixes ?? []).some(p => path.startsWith(p)));
  if (!found) throw new JoinError(`${path}: no domain matches it, add one to vocabulary.json domains`);
  return found.id;
};

/** The runtime's label when it gives one, else the first vocabulary resource rule whose match hits, with $1… filled. */
export const resourceOf = (path: string, resources: Resource[] | undefined, override: string | undefined): string | null => {
  if (override) return override;
  for (const r of resources ?? []) {
    const m = path.match(new RegExp(r.match));
    if (m) return r.label.replace(/\$(\d)/g, (_, i: string) => m[Number(i)] ?? '');
  }
  return null;
};

/** The inventory's two axes, as the first two check layers. */
export const routeLayers = (row: StatusRow): Layer[] =>
  (
    [
      ['authentication', 'authn', 'Sign-in'],
      ['authorization', 'route', 'Route check'],
    ] as const
  ).map(([axis, kind, title]) => {
    const value = row[axis];
    return {
      kind,
      title,
      value: value.value,
      text: value.raw ?? 'no check',
      where: value.layer,
      source: (value.rule ?? '').startsWith('builtin:') ? 'inventory' : `rule ${value.rule}`,
      at: value.evidence,
    };
  });

type Decides = Pick<RuntimeEndpoint, 'permissions' | 'verdict' | 'fallback' | 'notes'>;

/**
 * Who can pass, asked in order and stopping at the first yes: a verdict that settles it alone; anonymous access;
 * the roles holding the permissions; a verdict; the stack's reading of the rule; no check at all; else decided in code.
 */
export const who = (row: Pick<StatusRow, 'authentication' | 'authorization'>, rt: Decides, grants: Runtime['grants']): Who => {
  const { permissions, verdict, fallback } = rt;
  let notes = rt.notes;
  if (verdict && (verdict.kind === 'nobody' || verdict.kind === 'superuser' || !permissions.length)) return verdict;
  const authn = row.authentication;
  const authz = row.authorization;
  if (authn.value === 'anonymous') return { kind: 'anyone', ...fromAxis(authn) };
  if (permissions.length) {
    const roles = [...new Set(permissions.flatMap(p => (grants[p] ?? []).map(g => g.role)))].sort();
    const needs = permissions.join(' or ');
    if (!roles.length && !verdict)
      return {
        kind: 'superuser',
        basis: weakest('inferred', ...notes.map(([b]) => b)),
        how: `No role holds ${needs}: assumes nobody gets it directly on their account, so only a superuser passes.`,
      };
    if (verdict) notes = [...notes, ['inferred', 'code also decides beyond them']];
    return {
      kind: 'groups',
      roles,
      custom: Boolean(verdict),
      basis: weakest('extracted', ...notes.map(([b]) => b)),
      how: `Holds ${needs}; roles from the grants${notes.map(([, text]) => `; ${text}`).join('')}`,
    };
  }
  if (verdict) return verdict;
  if (fallback) return fallback;
  if (authz.value === 'none') return { kind: 'signed_in', ...fromAxis(authn) };
  return { kind: 'custom', basis: 'open', how: `Route rule ${ruleName(authz) || authz.raw} is not mapped to a role.` };
};

const NOTHING: RuntimeEndpoint = { method: '', path: '', handler: '', layers: [], permissions: [], verdict: null, fallback: null, notes: [] };

export interface Join {
  runtime: Runtime;
  vocabulary: Vocabulary;
  byKey: Map<string, RuntimeEndpoint>;
}

export const joiner = (runtime: Runtime, vocabulary: Vocabulary): Join => ({ runtime, vocabulary, byKey: indexRuntime(runtime) });

export const endpoint = (row: StatusRow, j: Join): MapEndpoint => {
  const path = row.path;
  const rt = j.byKey.get(`${row.method} ${path} ${row.handler}`) ?? NOTHING;
  const layers = [...routeLayers(row), ...rt.layers];
  let verdict = rt.verdict;
  const checks: RouteCheck[] = j.vocabulary.route_checks?.[path] ?? [];
  for (const check of checks) {
    layers.push({ kind: check.layer, title: 'Inside the handler', text: check.text, at: check.at, source: 'curated', permissions: check.permissions ?? [] });
    if (check.who) verdict = { kind: check.who, basis: 'curated', how: `${check.text} (${check.at})` };
  }
  const permissions = [...new Set([...rt.permissions, ...layers.flatMap(l => l.permissions ?? [])])].sort();
  return {
    key: row.key,
    method: row.method + (row.head ? '+HEAD' : ''),
    path,
    handler: row.handler,
    domain: domainOf(path, j.vocabulary.domains),
    resource: resourceOf(path, j.vocabulary.resources, rt.resource),
    dimensions: row.dimensions,
    authn: row.authentication.value,
    authz: row.authorization.value,
    tier: row.tier,
    inside: row.inside,
    signals: row.signals,
    verdict: row.verdict ? row.verdict.verdict : null,
    write: !['GET', 'OPTIONS'].includes(row.method),
    layers,
    permissions,
    grants: Object.fromEntries(permissions.map(p => [p, j.runtime.grants[p] ?? []])),
    who: who(row, { ...rt, verdict }, j.runtime.grants),
  };
};
