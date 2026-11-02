// The Map Introspect: reads the booted app as the Adapted Script does, and the Map Rules, into the Map Runtime.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { type Booted, ROOT } from '../access-inspector/boot.js';
import { classify, passportGuards } from '../access-inspector/classify.js';
import { discover } from '../access-inspector/discovery.js';
import type { Axis } from '../access-inspector/inventory.js';
import { type Metadata, RECOGNITION, type Rule, methods, resolveAccess } from '../access-inspector/rules.js';
import * as project from './project.js';
import { type Fact, MapRuleError, type Runtime, SCHEMA_VERSION, compareTuples } from './runtime.js';

export const ABOUT = {
  reads:
    "Every route the booted app serves, the guards and metadata on its handler and controller, the Adapted Script's" +
    ' Recognition Rules, and the Map Rules in tools/access-map/project.ts.',
  holds: [
    'Roles, scopes and capabilities from the Map Rules in tools/access-map/project.ts',
    'The signed-in role, at the first Recognition Rule that requires sign-in',
    'Per endpoint, the roles a roles guard lets through, read from the metadata its Recognition Rule names',
    'Per endpoint, the relation roles a Recognition Rule in RELATION_RULES lets through',
    'Handlers whose class or function is declared under the FIRST_PARTY directories',
  ],
  heuristics: ['A handler is first-party when a class or function of its name is declared under a FIRST_PARTY directory'],
  command: 'tools/access-inspector/inspect.sh map',
};

/** One inventory row, with the metadata its guards read. */
export interface Row {
  method: string;
  path: string;
  handler: string;
  authentication: Axis;
  authorization: Axis;
  metadata: Metadata;
}

/** The rows the Adapted Script would write, HEAD left out: a HEAD row repeats its GET. */
export const rows = async ({ app, watched }: Booted): Promise<Row[]> => {
  const passport = await passportGuards();
  const found: Row[] = [];
  for (const raw of discover(app, watched)) {
    if (raw.method === 'HEAD') continue;
    const { findings, metadata } = classify(raw, app, passport);
    for (const method of methods(findings, raw.method, raw.path, metadata)) {
      if (method === 'HEAD') continue;
      const [authentication, authorization] = resolveAccess(findings, method, raw.path, metadata);
      found.push({ method, path: raw.path, handler: raw.handler, authentication, authorization, metadata });
    }
  }
  return found;
};

const ruleOf = (axis: Axis, recognition: Rule[]): Rule | undefined => recognition.find(r => axis.rule === `recognition:${r.name}`);

/** What the checks settle on their own: the roles a roles guard names, or the relations a rule lets through. */
export const verdict = (row: Row, recognition: Rule[] = RECOGNITION, relations = project.RELATION_RULES): Fact | null => {
  const guard = ruleOf(row.authorization, recognition);
  if (row.authorization.value === 'rule' && guard?.rawMetadata !== undefined) {
    const value = row.metadata[guard.rawMetadata];
    const named = typeof value === 'string' ? [value] : value;
    if (Array.isArray(named) && named.length && named.every(r => typeof r === 'string')) {
      return {
        kind: 'groups',
        roles: [...new Set(named)].sort(),
        basis: 'rule',
        how: `Recognition rule ${guard.name} (${guard.evidence}) lets through ${guard.rawMetadata}=${JSON.stringify(value)}`,
      };
    }
  }
  for (const axis of [row.authentication, row.authorization]) {
    const rule = ruleOf(axis, recognition);
    if (rule !== undefined && relations[rule.name] !== undefined) {
      return { kind: 'relations', roles: [...relations[rule.name]!].sort(), basis: 'rule', how: `Recognition rule ${rule.name} (${rule.evidence})` };
    }
  }
  return null;
};

/** The facts one Map Rule returns, each holding `keys`. */
const facts = (rule: 'roles' | 'includes' | 'scopes' | 'scoped' | 'capabilities', keys: string[]): Fact[] => {
  const found = project[rule]();
  for (const fact of found) {
    const missing = keys.filter(k => !(k in fact));
    if (missing.length) throw new MapRuleError(`${rule}() returned ${JSON.stringify(fact)} without ${missing.join(', ')}`);
  }
  return found;
};

/** The Map Rule roles, and the signed-in role at the first Recognition Rule an endpoint requires sign-in by. */
export const roles = (found: Row[], recognition: Rule[] = RECOGNITION): Fact[] => {
  const declared = new Map<string, Fact & { includes: Fact[] }>();
  for (const r of facts('roles', ['id', 'kind', 'at'])) {
    declared.set(r.id as string, { id: r.id, kind: r.kind, at: r.at, basis: 'rule', includes: [], staff: null });
  }
  const signIn = recognition.find(r => r.authn === 'required' && found.some(e => ruleOf(e.authentication, [r])));
  if (signIn !== undefined && ![...declared.values()].some(r => r.kind === 'signed_in')) {
    const at = signIn.evidence;
    declared.set('user', { id: 'user', kind: 'signed_in', at, basis: 'rule', includes: [], staff: null });
  }
  for (const i of facts('includes', ['role', 'includes', 'at'])) {
    const role = declared.get(i.role as string);
    if (role === undefined) throw new MapRuleError(`includes(): no role '${String(i.role)}'`);
    role.includes.push({ role: i.includes, at: i.at });
  }
  for (const role of declared.values()) role.includes.sort((a, b) => compareTuples([a.role, a.at] as string[], [b.role, b.at] as string[]));
  return [...declared.values()];
};

/** Handlers whose controller class or function is declared under a FIRST_PARTY directory. */
export const firstParty = (handlers: string[], root: string = ROOT, dirs: string[] = project.FIRST_PARTY): string[] => {
  const names = new Set<string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (name === 'node_modules') continue;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.[cm]?tsx?$/.test(name) && !name.endsWith('.d.ts')) {
        for (const m of readFileSync(path, 'utf8').matchAll(/\b(?:class|function)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]!);
      }
    }
  };
  for (const dir of dirs) if (existsSync(join(root, dir))) walk(join(root, dir));
  return [...new Set(handlers.filter(h => names.has(h.split('.')[0]!)))].sort();
};

export const build = (found: Row[], version: string, recognition: Rule[] = RECOGNITION): Runtime => {
  const declared = roles(found, recognition);
  const known = new Set(declared.map(r => r.id));
  const endpoints: Fact[] = [];
  for (const row of found) {
    const decided = verdict(row, recognition);
    if (decided === null) continue;
    const unknown = (decided.roles as string[]).find(r => !known.has(r));
    if (unknown !== undefined) {
      throw new MapRuleError(`${row.method} ${row.path}: ${decided.how} names role '${unknown}' that roles() does not declare`);
    }
    const { method, path, handler } = row;
    endpoints.push({ method, path, handler, layers: [], permissions: [], verdict: decided, fallback: null, notes: [] });
  }
  const capability = ['id', 'area', 'term', 'verb', 'endpoints', 'check', 'at'];
  const pick = (fact: Fact, keys: string[]): Fact => Object.fromEntries(keys.map(k => [k, fact[k]]));
  return {
    schema_version: SCHEMA_VERSION,
    stack: 'nestjs',
    base_script: { stack: 'nestjs', version },
    about: ABOUT,
    roles: declared,
    areas: [],
    grants: {},
    scopes: facts('scopes', ['id', 'label', 'at']).map(s => ({ ...pick(s, ['id', 'label', 'at']), basis: 'inferred' })),
    scoped: facts('scoped', ['capability', 'role', 'scope', 'at']).map(s => ({ ...pick(s, ['capability', 'role', 'scope', 'at']), basis: 'rule' })),
    capabilities: facts('capabilities', capability).map(c => ({ ...pick(c, capability), basis: 'rule' })),
    endpoints,
    first_party: firstParty(found.map(r => r.handler)),
    snippets: {},
  };
};
