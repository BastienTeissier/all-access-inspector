// The Committed Inventory as the review needs it: its endpoints, their Review Key, HEAD folding and zones.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Where the toolkit keeps a project's inventory and Review Log. */
export const toolsDir = (project: string): string => join(project, 'tools', 'access-inspector');

/** What a review keeps of an axis: evidence is left out, it moves with unrelated edits. */
export const SEEN_FIELDS = ['value', 'layer', 'raw', 'rule'] as const;

export interface Axis {
  value: string;
  layer: string | null;
  raw: string | null;
  rule: string | null;
  evidence: string | null;
}

export interface Endpoint {
  method: string;
  path: string;
  handler: string;
  authentication: Axis;
  authorization: Axis;
  dimensions: Record<string, string>;
  unknown_reason: string | null;
  acknowledged: boolean;
}

/** What each dimension value should allow: { dimension: { value: { authentication, authorization } } }. */
export type ExpectedAccess = Record<string, Record<string, { authentication: string[]; authorization: string[] }>>;

export interface Inventory {
  schema_version: string;
  stack: string;
  coverage: string;
  expected_access: ExpectedAccess;
  endpoints: Endpoint[];
}

/** (method, path, handler with its line stripped): moving a handler within its file keeps its reviews. */
export type Key = [string, string, string];

/** An axis as a review saw it: its SEEN_FIELDS. */
export type SeenAxis = Pick<Axis, (typeof SEEN_FIELDS)[number]>;

export interface Seen {
  handler: string;
  authentication: SeenAxis;
  authorization: SeenAxis;
  inside: boolean | null;
}

/** An endpoint as one review row: a HEAD identical to its GET is folded into it (`head`). */
export interface Folded extends Endpoint {
  head: boolean;
}

export class InventoryError extends Error {}

export const loadInventory = (path: string): Inventory => {
  let data: Inventory;
  try {
    data = JSON.parse(readFileSync(path, 'utf8')) as Inventory;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new InventoryError(code === 'ENOENT' ? `${path} not found: fit the project first` : `cannot read ${path}: ${(error as Error).message}`);
  }
  if (data.schema_version !== '1') throw new InventoryError(`${path}: schema_version ${JSON.stringify(data.schema_version)} is not supported, expected "1"`);
  if (!Array.isArray(data.endpoints)) throw new InventoryError(`${path}: no endpoints`);
  data.expected_access ??= {};
  return data;
};

export const keyOf = (e: { method: string; path: string; handler: string }): Key => [e.method, e.path, e.handler.replace(/:\d+$/, '')];

export const keyText = (key: Key): string => JSON.stringify(key);

/** The file of a project handler (`file:line`), or null for a framework handler (a dotted name), which serves unrelated paths. */
export const handlerFile = (handler: string): string | null => (/:\d+$/.test(handler) ? handler.replace(/:\d+$/, '') : null);

export const isUnknown = (e: Endpoint): boolean => e.authentication.value === 'unknown' || e.authorization.value === 'unknown';

/** Same rule as the viewer's `fold`: a HEAD equal to its GET in everything but the method is shown as that GET. */
export const foldHead = (endpoints: Endpoint[]): Folded[] => {
  const signature = (e: Endpoint) =>
    JSON.stringify([e.path, e.handler, e.authentication, e.authorization, e.dimensions, e.unknown_reason, e.acknowledged]);
  const gets = new Map<string, Folded>();
  const rows: Folded[] = [];
  for (const e of endpoints) {
    const get = e.method === 'HEAD' ? gets.get(signature(e)) : undefined;
    if (get) {
      get.head = true;
      continue;
    }
    const row = { ...e, head: false };
    if (e.method === 'GET') gets.set(signature(e), row);
    rows.push(row);
  }
  return rows;
};

/**
 * Whether the endpoint is within the expected access of its zones: false when one dimension says no,
 * null when no dimension has an expectation for it or an axis is unknown (as the viewer: unknown is never outside).
 */
export const inside = (e: Endpoint, expected: ExpectedAccess): boolean | null => {
  if (isUnknown(e)) return null;
  let checked = false;
  for (const [dimension, value] of Object.entries(e.dimensions)) {
    const x = expected[dimension]?.[value];
    if (!x) continue;
    if (!x.authentication.includes(e.authentication.value) || !x.authorization.includes(e.authorization.value)) return false;
    checked = true;
  }
  return checked ? true : null;
};

/** The SEEN_FIELDS of an axis, in that order. */
export const seenAxis = (a: SeenAxis): SeenAxis => ({ value: a.value, layer: a.layer, raw: a.raw, rule: a.rule });

export const seenOf = (e: Endpoint, expected: ExpectedAccess): Seen => ({
  handler: e.handler,
  authentication: seenAxis(e.authentication),
  authorization: seenAxis(e.authorization),
  inside: inside(e, expected),
});

export const classification = (a: { authentication: { value: string }; authorization: { value: string } }): string =>
  `${a.authentication.value}/${a.authorization.value}`;
