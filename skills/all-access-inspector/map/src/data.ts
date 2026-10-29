// Page data: everything the static page and the app pages draw, derived from the project's files, never stored.

import { basename, resolve } from 'node:path';

import { output } from '../../review/src/output.ts';
import { readLog, now } from '../../review/src/log.ts';
import { load } from '../../review/src/project.ts';
import { type Alert, alerts } from './alerts.ts';
import { type Capability, type Cell, cells, capabilityList, endpointsOf } from './cells.ts';
import { type MapEndpoint, type StatusRow, endpoint, joiner } from './join.ts';
import { type Reach, type Role, reach, roleList } from './roles.ts';
import { type About, loadRuntime, runtimePath } from './runtime.ts';
import { type Vocabulary, loadVocabulary, vocabularyPath } from './vocabulary.ts';

export interface Options {
  vocabulary?: string;
  runtime?: string;
}

export interface PageArea {
  id: string;
  name: string;
  term: string | null;
  defined_at: string | null;
  capabilities: Capability[];
}

export interface PageEndpoint extends MapEndpoint {
  reach: Record<string, Reach>;
}

export interface PageCell extends Omit<Cell, 'decision'> {
  decision: {
    verdict: string;
    by: string;
    at: string;
    reason: string;
    severity?: string;
    ticket?: string;
    until?: string;
    state: 'valid' | 'outdated';
    expired: boolean;
  } | null;
}

export interface PageData {
  project: { name: string; stack: string };
  inventory: { count: number; base_script: unknown };
  roles: Role[];
  areas: PageArea[];
  cells: PageCell[];
  endpoints: PageEndpoint[];
  alerts: Alert[];
  coverage: { covered: number; total: number };
  snippets: Record<string, string>;
  method: {
    rows: number;
    rules: number;
    permissions: number;
    grants: number;
    anchors: number;
    route_checks: number;
    capabilities: Record<string, number>;
    layer_sources: Record<string, number>;
    runtime: About | null;
    runtime_note: string | null;
  };
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Every row, highest tier first, then path and method: the Review Queue's order, verdicts included. */
const ordered = (rows: StatusRow[]): StatusRow[] => [...rows].sort((a, b) => a.tier - b.tier || byText(a.path, b.path) || byText(a.method, b.method));

/** Vocabulary areas first, in their order, then any area a capability names that the vocabulary does not. */
const areaList = (vocabulary: Vocabulary, caps: Capability[]): PageArea[] => {
  const areas: PageArea[] = vocabulary.areas.map(a => ({ ...a, capabilities: [] }));
  for (const cap of caps) {
    let area = areas.find(a => a.id === cap.area);
    if (!area) {
      area = { id: cap.area, name: cap.area, term: cap.term, defined_at: null, capabilities: [] };
      areas.push(area);
    }
    area.capabilities.push(cap);
  }
  return areas;
};

const count = (xs: string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
};

/** The project as the map reads it, plus what `map check` needs that the page does not draw. */
export const project = (dir: string, options: Options = {}) => {
  const vocabulary = loadVocabulary(options.vocabulary ?? vocabularyPath(dir));
  const { inventory, rows: all } = load(dir);
  const rows = ordered(all.map(output));
  const { runtime, note } = loadRuntime(options.runtime ?? runtimePath(dir), inventory.stack);
  const j = joiner(runtime, vocabulary);
  const endpoints = rows.map(row => endpoint(row, j));
  const roles = roleList(runtime, vocabulary);
  const caps = capabilityList(runtime, vocabulary);
  const found = caps.map(cap => ({ cap, ...endpointsOf(cap, endpoints) }));
  const computed = cells(caps, roles, endpoints, runtime, vocabulary, readLog(dir).cells, now().slice(0, 10));
  return { inventory, rows, runtime, note, vocabulary, endpoints, roles, caps, found, ...computed };
};

export const buildData = (dir: string, options: Options = {}): PageData => {
  const p = project(dir, options);
  const covered = new Set(p.found.flatMap(f => f.found));
  const names = new Map(p.caps.map(c => [c.id, c.name]));
  const roleNames = new Map(p.roles.map(r => [r.id, r.name]));
  const rules = new Set(p.inventory.endpoints.flatMap(e => [e.authentication.rule, e.authorization.rule]).filter(r => r?.startsWith('recognition:')));
  return {
    project: { name: basename(resolve(dir)), stack: p.inventory.stack },
    inventory: { count: p.inventory.endpoints.length, base_script: (p.inventory as unknown as { base_script?: unknown }).base_script ?? null },
    roles: p.roles,
    areas: areaList(p.vocabulary, p.caps),
    cells: p.cells.map(c => {
      const d = c.decision;
      const { verdict, by, at, reason, severity, ticket, until } = d?.decision ?? ({} as Record<string, never>);
      return {
        ...c,
        decision: d && d.state !== 'orphaned' ? { verdict, by, at, reason, severity, ticket, until, state: d.state, expired: d.expired } : null,
      };
    }),
    endpoints: p.endpoints.map(e => ({ ...e, reach: Object.fromEntries(p.roles.map(r => [r.id, reach(e.who, r)])) })),
    alerts: alerts(p.cells, p.agents, p.endpoints, covered, ([c, r]) => `${names.get(c) ?? c} for ${roleNames.get(r) ?? r}`),
    coverage: { covered: covered.size, total: p.endpoints.length },
    snippets: p.runtime.snippets,
    method: {
      rows: p.rows.length,
      rules: rules.size,
      permissions: Object.keys(p.runtime.grants).length,
      grants: Object.values(p.runtime.grants).reduce((n, g) => n + g.length, 0),
      anchors: Object.keys(p.vocabulary.anchors ?? {}).length,
      route_checks: Object.values(p.vocabulary.route_checks ?? {}).reduce((n, v) => n + v.length, 0),
      capabilities: count(p.caps.map(c => c.basis)),
      layer_sources: count(p.endpoints.flatMap(e => e.layers.map(l => (l.source.startsWith('rule ') ? 'rule' : l.source)))),
      runtime: p.runtime.about,
      runtime_note: p.note,
    },
  };
};
