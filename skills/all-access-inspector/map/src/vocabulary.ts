// The Map Vocabulary: what the code does not declare in a form a program can read, written by hand, each file:line pinned.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { WHO_KINDS, type Runtime, type WhoKind } from './runtime.ts';

/** A project file:line written by hand somewhere in the vocabulary. */
const REFERENCE = /\b((?:[\w-]+\/)*[\w-]+\.(?:py|html|ts|tsx|js|java|kt|php|twig|ya?ml|xml|md)):(\d+)\b/g;
const AT = /^[^\s:]+:\d+$/;

export interface Area {
  id: string;
  name: string;
  term: string;
  defined_at: string | null;
}

export interface VocabularyRole {
  id: string;
  name?: string;
  doc_at?: string;
  kind?: 'signed_in' | 'superuser' | 'group';
  at?: string;
  reason?: string;
  includes?: { role: string; at: string }[];
  staff?: { at: string };
}

export interface Extends {
  extends: string;
  name: string;
  sub?: string;
  area?: string;
}

export interface Written {
  id: string;
  name: string;
  sub?: string;
  area: string;
  verb: 'read' | 'write';
  endpoints: string[][];
  check: string;
  evidence: [string, string][];
  reason: string;
  replaces?: string[];
}

export interface Domain {
  id: string;
  name: string;
  contains?: string[];
  prefixes?: string[];
}

export interface Resource {
  match: string; // a regular expression tried against the path; $1… in label are its groups
  label: string;
}

export interface RouteCheck {
  layer: 'permission' | 'scope' | 'view' | 'write' | 'body';
  text: string;
  at: string;
  permissions?: string[];
  who?: WhoKind;
}

export interface Vocabulary {
  areas: Area[];
  roles: VocabularyRole[];
  capabilities: (Extends | Written)[];
  scopes?: { id: string; label: string; at: string; reason: string }[];
  scoped?: { capability: string; role: string; scope: string; at: string; reason: string }[];
  domains?: Domain[];
  resources?: Resource[];
  route_checks?: Record<string, RouteCheck[]>;
  stack?: Record<string, unknown>; // read by the stack's introspect only
  anchors?: Record<string, string>;
}

export class VocabularyError extends Error {}

export const vocabularyPath = (project: string): string => join(project, 'tools', 'access-map', 'vocabulary.json');

type Item = Record<string, unknown>;

const text = (v: unknown) => typeof v === 'string' && /\S/.test(v);
const at = (v: unknown) => typeof v === 'string' && AT.test(v);
const list = (v: unknown) => v === undefined || Array.isArray(v);

/** The first field of one entry that breaks the schema, as `field: what is wrong`, or null. */
const roleProblem = (r: Item): string | null => {
  if (!text(r.id)) return 'id: required';
  if (r.kind === undefined) return ['at', 'reason', 'includes', 'staff'].find(k => r[k] !== undefined)?.concat(': only on a role written by hand, with kind') ?? null;
  if (!['signed_in', 'superuser', 'group'].includes(r.kind as string)) return `kind: ${JSON.stringify(r.kind)} is not signed_in, superuser or group`;
  if (!at(r.at)) return 'at: file:line required';
  if (!text(r.reason)) return 'reason: required on a role written by hand';
  return list(r.includes) ? null : 'includes: must be a list';
};

const capabilityProblem = (c: Item): string | null => {
  if (!text(c.name)) return 'name: required';
  if (c.extends !== undefined) return text(c.extends) ? null : 'extends: required';
  if (!text(c.id)) return 'id: required, or extends';
  if (!text(c.area)) return 'area: required';
  if (c.verb !== 'read' && c.verb !== 'write') return `verb: ${JSON.stringify(c.verb)} is not read or write`;
  if (!Array.isArray(c.endpoints) || !c.endpoints.length || !c.endpoints.every(e => Array.isArray(e) && e.length >= 2 && e.length <= 3))
    return 'endpoints: [[method, path], …] or [[method, path, handler], …]';
  if (typeof c.check !== 'string') return 'check: required';
  if (!Array.isArray(c.evidence) || !c.evidence.length || !c.evidence.every(e => Array.isArray(e) && at(e[0]) && typeof e[1] === 'string'))
    return 'evidence: [[file:line, text], …]';
  if (!text(c.reason)) return 'reason: required on a capability written by hand';
  return list(c.replaces) ? null : 'replaces: must be a list';
};

const areaProblem = (a: Item): string | null =>
  !text(a.id) ? 'id: required' : !text(a.name) ? 'name: required' : !text(a.term) ? 'term: required' : a.defined_at === null || at(a.defined_at) ? null : 'defined_at: file:line or null';

const reasoned = (keys: string[]) => (s: Item): string | null =>
  keys.find(k => !text(s[k]))?.concat(': required') ?? (at(s.at) ? null : 'at: file:line required');

const routeCheckProblem = (c: Item): string | null => {
  if (!['permission', 'scope', 'view', 'write', 'body'].includes(c.layer as string)) return `layer: ${JSON.stringify(c.layer)} is not a layer kind`;
  if (!text(c.text)) return 'text: required';
  if (!at(c.at)) return 'at: file:line required';
  return c.who === undefined || WHO_KINDS.includes(c.who as WhoKind) ? null : `who: ${JSON.stringify(c.who)} is not a who kind`;
};

/** Every entry checked against schema/vocabulary.schema.json by hand: the CLI needs no install. */
export const vocabularyProblem = (data: Item): string | null => {
  for (const key of ['areas', 'roles', 'capabilities'] as const) if (!Array.isArray(data[key])) return `${key}: required list`;
  const lists: [string, (i: Item) => string | null][] = [
    ['areas', areaProblem],
    ['roles', roleProblem],
    ['capabilities', capabilityProblem],
    ['scopes', reasoned(['id', 'label', 'reason'])],
    ['scoped', reasoned(['capability', 'role', 'scope', 'reason'])],
  ];
  for (const [key, problem] of lists) {
    if (!list(data[key])) return `${key}: must be a list`;
    for (const [i, item] of ((data[key] as Item[] | undefined) ?? []).entries()) {
      const wrong = item && typeof item === 'object' ? problem(item) : 'must be an object';
      if (wrong) return `${key}[${i}]${item && text(item.id) ? ` ${item.id}` : ''}: ${wrong}`;
    }
  }
  for (const [path, checks] of Object.entries((data.route_checks as Record<string, Item[]> | undefined) ?? {})) {
    if (!Array.isArray(checks)) return `route_checks ${path}: must be a list`;
    for (const [i, c] of checks.entries()) {
      const wrong = routeCheckProblem(c);
      if (wrong) return `route_checks ${path}[${i}]: ${wrong}`;
    }
  }
  return null;
};

export const loadVocabulary = (path: string): Vocabulary => {
  if (!existsSync(path)) throw new VocabularyError(`${path} not found: write the vocabulary first (see the Map section of SKILL.md)`);
  let data: Item;
  try {
    data = JSON.parse(readFileSync(path, 'utf8')) as Item;
  } catch (error) {
    throw new VocabularyError(`${path}: not valid JSON (${(error as Error).message})`);
  }
  const wrong = vocabularyProblem(data);
  if (wrong) throw new VocabularyError(`${path}: ${wrong}`);
  return data as unknown as Vocabulary;
};

/** Every file:line in the vocabulary, anchors and the introspect's own `stack` section left out. */
export const references = (node: unknown): Set<string> => {
  const found = new Set<string>();
  const walk = (n: unknown) => {
    if (typeof n === 'string') for (const m of n.matchAll(REFERENCE)) found.add(`${m[1]}:${m[2]}`);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) if (k !== 'anchors' && k !== 'stack') walk(v);
  };
  walk(node);
  return found;
};

const fileLines = (project: string, path: string): string[] | null => {
  const file = join(project, path);
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').map(l => l.trim()) : null;
};

/** The trimmed text of a file:line, or null when the file or the line is missing. */
export const lineAt = (project: string, ref: string): string | null => {
  const i = ref.lastIndexOf(':');
  const lines = fileLines(project, ref.slice(0, i));
  const number = Number(ref.slice(i + 1));
  return lines && number <= lines.length ? (lines[number - 1] ?? null) : null;
};

const sorted = (xs: Iterable<string>) => [...xs].sort();

/** Every file:line must still show the line it was written against. One problem per line, empty when none. */
export const staleReferences = (project: string, vocabulary: Vocabulary): string[] => {
  const anchors = vocabulary.anchors ?? {};
  const refs = references(vocabulary);
  const problems = sorted([...refs].filter(r => !(r in anchors))).map(r => `${r}: no anchor, run map pin`);
  problems.push(...sorted(Object.keys(anchors).filter(r => !refs.has(r))).map(r => `${r}: anchor no longer used`));
  for (const ref of sorted([...refs].filter(r => r in anchors))) {
    const expected = anchors[ref] as string;
    if (lineAt(project, ref) === expected) continue;
    const path = ref.slice(0, ref.lastIndexOf(':'));
    const moved = (fileLines(project, path) ?? []).flatMap((x, i) => (x === expected ? [String(i + 1)] : []));
    problems.push(`${ref}: expected \`${expected}\`, ${moved.length ? `moved to ${path}:${moved.join(', ')}` : 'line is gone'}`);
  }
  return problems;
};

/** Record the current text of every reference that has no anchor yet; never overwrites one. Returns what it did. */
export const pin = (project: string, path: string, vocabulary: Vocabulary): string[] => {
  const anchors = vocabulary.anchors ?? {};
  const out: string[] = [];
  for (const ref of sorted([...references(vocabulary)].filter(r => !(r in anchors)))) {
    const found = lineAt(project, ref);
    if (!found) {
      out.push(`${ref}: blank or missing line, not pinned`);
      continue;
    }
    anchors[ref] = found;
    out.push(`pinned ${ref}: ${found}`);
  }
  vocabulary.anchors = Object.fromEntries(Object.entries(anchors).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  writeFileSync(path, `${JSON.stringify(vocabulary, null, 2)}\n`);
  return out;
};

/** Terms the map shows that the project's CONTEXT.md never mentions; nothing when it has none. */
export const missingTerms = (project: string, terms: string[]): string[] => {
  const file = join(project, 'CONTEXT.md');
  if (!existsSync(file)) return [];
  const context = readFileSync(file, 'utf8');
  return sorted(new Set(terms.filter(t => !context.includes(t)))).map(t => `term "${t}" is not in CONTEXT.md`);
};

const source = (basis: string) => (basis === 'extracted' ? 'the Map Introspect reads it' : 'a Map Rule produces it');

/** Read before you write: a vocabulary entry the runtime already holds is a duplicate. */
export const duplicates = (vocabulary: Vocabulary, runtime: Runtime): string[] => {
  const problems: string[] = [];
  const roles = new Map(runtime.roles.map(r => [r.id, r]));
  for (const r of vocabulary.roles) {
    const found = roles.get(r.id);
    if (r.kind && found) problems.push(`vocabulary role "${r.id}": ${source(found.basis)} at ${found.at}, name it with {id, name} only`);
  }
  const caps = new Map(runtime.capabilities.map(c => [c.id, c]));
  for (const c of vocabulary.capabilities) {
    const found = 'id' in c ? caps.get(c.id) : undefined;
    if (found) problems.push(`vocabulary capability "${found.id}": ${source(found.basis)} at ${found.at}, use {extends: "${found.id}", name}`);
  }
  const scopes = new Map(runtime.scopes.map(s => [s.id, s]));
  for (const s of vocabulary.scopes ?? []) {
    const found = scopes.get(s.id);
    if (found) problems.push(`vocabulary scope "${s.id}": ${source(found.basis)} at ${found.at}`);
  }
  const scoped = new Set(runtime.scoped.map(s => `${s.capability} ${s.role}`));
  for (const s of vocabulary.scoped ?? [])
    if (scoped.has(`${s.capability} ${s.role}`)) problems.push(`vocabulary scoped "${s.capability}" for "${s.role}": a Map Rule produces it`);
  return problems;
};
