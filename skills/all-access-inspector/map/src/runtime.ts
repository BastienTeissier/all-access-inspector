// What the stack's Map Introspect read (schema/runtime.schema.json), or an empty runtime when the stack has none.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const BASES = ['extracted', 'rule', 'curated', 'inferred', 'open'] as const;
export type Basis = (typeof BASES)[number];

export const WHO_KINDS = ['anyone', 'signed_in', 'staff', 'groups', 'superuser', 'nobody', 'custom'] as const;
export type WhoKind = (typeof WHO_KINDS)[number];

export interface Who {
  kind: WhoKind;
  basis: Basis;
  how: string;
  roles?: string[]; // kind groups: the roles holding the permissions
  custom?: boolean; // kind groups: code also decides beyond the permissions
}

export interface Layer {
  kind: string;
  title: string;
  text: string;
  source: string;
  at?: string | null;
  permissions?: string[];
  value?: string;
  where?: string | null;
}

export type EndpointKey = [string, string, string];

export interface RuntimeEndpoint {
  method: string;
  path: string;
  handler: string;
  resource?: string;
  layers: Layer[];
  permissions: string[];
  verdict: Who | null;
  fallback: Who | null;
  notes: [Basis, string][];
}

export interface RuntimeRole {
  id: string;
  kind: 'signed_in' | 'superuser' | 'group';
  at: string;
  basis: Basis;
  includes: { role: string; at: string }[];
  staff: { at: string } | null;
}

export interface RuntimeScope {
  id: string;
  label: string;
  at: string;
  basis: Basis;
}

export interface Scoped {
  capability: string;
  role: string;
  scope: string;
  at: string;
  basis: Basis;
}

export interface RuntimeCapability {
  id: string;
  area: string;
  term: string;
  verb: 'read' | 'write';
  endpoints: EndpointKey[];
  check: string;
  at: string;
  basis: Basis;
}

export interface About {
  reads: string;
  holds: string[];
  heuristics: string[];
  command: string;
}

export interface Runtime {
  schema_version: '1';
  stack: string;
  base_script: { stack: string; version: string } | null;
  about: About | null;
  roles: RuntimeRole[];
  grants: Record<string, { role: string; at: string }[]>;
  scopes: RuntimeScope[];
  scoped: Scoped[];
  capabilities: RuntimeCapability[];
  endpoints: RuntimeEndpoint[];
  snippets: Record<string, string>;
}

export class RuntimeError extends Error {}

export const runtimePath = (project: string): string => join(project, 'tools', 'access-map', 'runtime.json');

/** A stack with no Map Introspect: the badges rest on the inventory and the vocabulary alone. */
export const emptyRuntime = (stack: string): Runtime => ({
  schema_version: '1',
  stack,
  base_script: null,
  about: null,
  roles: [],
  grants: {},
  scopes: [],
  scoped: [],
  capabilities: [],
  endpoints: [],
  snippets: {},
});

const LISTS = ['roles', 'scopes', 'scoped', 'capabilities', 'endpoints'] as const;

export const loadRuntime = (path: string, stack: string): { runtime: Runtime; note: string | null } => {
  if (!existsSync(path)) return { runtime: emptyRuntime(stack), note: `no ${path}: no Map Introspect for ${stack}, the map rests on the inventory and the vocabulary` };
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new RuntimeError(`${path}: not valid JSON (${(error as Error).message})`);
  }
  if (data.schema_version !== '1') throw new RuntimeError(`${path}: schema_version ${JSON.stringify(data.schema_version)} is not supported, expected "1"`);
  for (const key of LISTS) if (!Array.isArray(data[key])) throw new RuntimeError(`${path}: ${key} must be a list`);
  for (const key of ['grants', 'snippets'] as const)
    if (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key])) throw new RuntimeError(`${path}: ${key} must be an object`);
  return { runtime: data as unknown as Runtime, note: null };
};

export const runtimeKey = (e: { method: string; path: string; handler: string }): string => `${e.method} ${e.path} ${e.handler}`;

/** Runtime endpoints by method, path and handler. */
export const indexRuntime = (runtime: Runtime): Map<string, RuntimeEndpoint> => new Map(runtime.endpoints.map(e => [runtimeKey(e), e]));
