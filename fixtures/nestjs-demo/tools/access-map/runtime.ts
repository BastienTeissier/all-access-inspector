// The Map Runtime: canonical serialisation, the --check diff, and file:line lookup for Map Rules.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SCHEMA_VERSION = '1';
export const KEYS = [
  'schema_version',
  'stack',
  'base_script',
  'about',
  'roles',
  'areas',
  'grants',
  'scopes',
  'scoped',
  'capabilities',
  'endpoints',
  'first_party',
  'snippets',
] as const;
// How each list is sorted and how one of its items is named in a diff.
export const IDENTITY: Record<string, string[]> = {
  roles: ['id'],
  areas: ['id'],
  scopes: ['id'],
  scoped: ['capability', 'role', 'scope'],
  capabilities: ['id'],
  endpoints: ['path', 'method', 'handler'],
};

export type Fact = Record<string, unknown>;
export type Runtime = Record<string, unknown>;

/** A Map Rule cites a line that is not in the file, or returns a malformed fact: exit 2. */
export class MapRuleError extends Error {}

/** `path:line` of the first line of `path` containing `text`, for a Map Rule's `at`. */
export const lineOf = (root: string, path: string, text: string): string => {
  const lines = readFileSync(join(root, path), 'utf8').split(/\r\n|\r|\n/);
  const index = lines.findIndex(line => line.includes(text));
  if (index < 0) throw new MapRuleError(`${path}: no line contains ${JSON.stringify(text)}`);
  return `${path}:${index + 1}`;
};

/** By code point, as Python sorts strings. */
const compareText = (a: string, b: string): number => {
  const [x, y] = [[...a], [...b]];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
  }
  return x.length - y.length;
};

export const compareTuples = (a: string[], b: string[]): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = compareText(a[i]!, b[i]!);
    if (c !== 0) return c;
  }
  return a.length - b.length;
};

const identity = (name: string, item: Fact): string[] => IDENTITY[name]!.map(k => String(item[k]));

const sortedEntries = <T>(o: Record<string, T>): [string, T][] => Object.entries(o).sort(([a], [b]) => compareText(a, b));

/** Keys in schema order, lists sorted, grants by role: equal content gives equal bytes. */
export const canonical = (runtime: Runtime): Runtime => {
  const full: Runtime = { areas: [], first_party: [], ...runtime }; // optional in the schema: a committed runtime may leave both out
  const out: Runtime = Object.fromEntries(KEYS.map(k => [k, full[k]]));
  for (const name of Object.keys(IDENTITY)) {
    out[name] = [...(full[name] as Fact[])].sort((a, b) => compareTuples(identity(name, a), identity(name, b)));
  }
  out.grants = Object.fromEntries(
    sortedEntries(full.grants as Record<string, { role: string; at: string }[]>).map(([permission, holders]) => [
      permission,
      [...holders].sort((a, b) => compareTuples([a.role, a.at], [b.role, b.at])),
    ]),
  );
  out.first_party = [...(full.first_party as string[])].sort(compareText);
  out.snippets = Object.fromEntries(sortedEntries(full.snippets as Record<string, string>));
  return out;
};

/** json.dumps(value, ensure_ascii=False, separators=(", ", ": ")) */
const compact = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(compact).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${compact(v)}`).join(', ')}}`;
  }
  return JSON.stringify(value);
};

/** One root key per line; each list item, grant and snippet on its own line. */
export const toCanonicalJson = (runtime: Runtime): string => {
  const data = canonical(runtime);
  const lines = ['{'];
  KEYS.forEach((key, i) => {
    const comma = i < KEYS.length - 1 ? ',' : '';
    const value = data[key];
    let items: string[] | null = null;
    if (Array.isArray(value) && value.length > 0) {
      items = value.map(item => `    ${compact(item)}`);
    } else if ((key === 'grants' || key === 'snippets') && Object.keys(value as object).length > 0) {
      items = Object.entries(value as object).map(([k, v]) => `    ${compact(k)}: ${compact(v)}`);
    }
    if (items === null) {
      lines.push(`  ${compact(key)}: ${compact(value)}${comma}`);
      return;
    }
    const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
    lines.push(`  ${compact(key)}: ${open}`, items.join(',\n'), `  ${close}${comma}`);
  });
  lines.push('}');
  return `${lines.join('\n')}\n`;
};

/** Diff lines from the committed runtime to the regenerated one; empty when they match. */
export const check = (committed: Runtime, current: Runtime): string[] => {
  const old = canonical(committed);
  const now = canonical(JSON.parse(toCanonicalJson(current)) as Runtime);
  const lines: string[] = [];
  for (const key of KEYS) {
    if (compact(old[key]) === compact(now[key])) continue;
    let before: Map<string, [string[], unknown]>;
    let after: Map<string, [string[], unknown]>;
    const index = (entries: [string[], unknown][]) => new Map(entries.map(([ident, item]) => [JSON.stringify(ident), [ident, item] as [string[], unknown]]));
    if (key in IDENTITY) {
      before = index((old[key] as Fact[]).map(item => [identity(key, item), item]));
      after = index((now[key] as Fact[]).map(item => [identity(key, item), item]));
    } else if (key === 'grants' || key === 'snippets') {
      before = index(Object.entries(old[key] as object).map(([k, v]) => [[k], v]));
      after = index(Object.entries(now[key] as object).map(([k, v]) => [[k], v]));
    } else {
      lines.push(`~ ${key}: ${compact(old[key])} -> ${compact(now[key])}`);
      continue;
    }
    const idents = new Map([...before, ...after].map(([k, [ident]]) => [k, ident]));
    for (const [k, ident] of [...idents].sort(([, a], [, b]) => compareTuples(a, b))) {
      const name = `${key} ${ident.join(' ')}`;
      const was = before.get(k)?.[1];
      const is = after.get(k)?.[1];
      if (!after.has(k)) lines.push(`- ${name}`);
      else if (!before.has(k)) lines.push(`+ ${name}: ${compact(is)}`);
      else if (compact(was) !== compact(is)) lines.push(`~ ${name}: ${compact(was)} -> ${compact(is)}`);
    }
  }
  return lines;
};
