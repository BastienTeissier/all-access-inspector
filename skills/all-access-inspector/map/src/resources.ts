// Derived capabilities: one per REST resource and verb, read from the inventory's path shapes on every stack (ADR 0007).

import type { Capability } from './cells.ts';
import type { MapEndpoint } from './join.ts';

const VERBS = [
  ['list', 'collection', ['GET']],
  ['read', 'detail', ['GET']],
  ['create', 'collection', ['POST']],
  ['update', 'detail', ['PUT', 'PATCH']],
  ['delete', 'detail', ['DELETE']],
] as const;
const ACTION_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const isParam = (segment: string) => /^\{[^}]*\}$/.test(segment);
const segments = (path: string) => path.split('/').filter(Boolean);
/** A path shape: its segments, every parameter alike, so `/a/{pk}/` and `/a/{id}` are one shape. */
const shape = (segs: string[]) => segs.map(s => (isParam(s) ? '{}' : s)).join('/');
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One capability per resource and verb, and one per action nested under a resource's detail path.
 * A resource is a collection path whose detail sibling (`<prefix>/{param}`) also exists; third-party handlers are never derived from. */
export const resources = (endpoints: MapEndpoint[], firstParty: (handler: string) => boolean): Capability[] => {
  const own = endpoints.filter(e => firstParty(e.handler));
  const at = new Map<string, MapEndpoint[]>();
  for (const e of own) {
    const key = shape(segments(e.path));
    at.set(key, [...(at.get(key) ?? []), e]);
  }
  const isResource = (key: string) => key !== '' && at.has(key) && at.has(`${key}/{}`);
  const found = new Map<string, Capability>();
  const add = (prefix: string[], id: string, name: string, write: boolean, rows: MapEndpoint[]) => {
    if (!rows.length) return;
    const slug = prefix.filter(s => !isParam(s)).join('.');
    const full = `resource.${slug}.${id}`;
    const cap = found.get(full);
    if (cap) {
      cap.endpoints.push(...rows.map(e => e.key));
      if (write) cap.verb = 'write';
      return;
    }
    found.set(full, {
      id: full,
      name,
      sub: null,
      area: slug,
      term: null,
      verb: write ? 'write' : 'read',
      endpoints: rows.map(e => e.key),
      check: rows[0]!.who.how,
      at: null,
      basis: 'inferred',
      reason: null,
      derived: 'resource',
    });
  };
  for (const key of [...at.keys()].sort()) {
    if (!isResource(key)) continue;
    const prefix = segments(at.get(key)![0]!.path);
    const last = prefix.filter(s => !isParam(s)).at(-1) ?? '';
    for (const [verb, side, methods] of VERBS) {
      const rows = (at.get(side === 'collection' ? key : `${key}/{}`) ?? []).filter(e => (methods as readonly string[]).includes(e.key[0]));
      add(prefix, verb, `${capitalise(verb)} ${last}`, verb !== 'list' && verb !== 'read', rows);
    }
    const under = `${key}/{}/`;
    for (const nested of [...at.keys()].sort()) {
      const segment = nested.startsWith(under) ? nested.slice(under.length) : '';
      if (!segment || segment.includes('/') || segment === '{}' || isResource(nested)) continue;
      const rows = at.get(nested)!.filter(e => ACTION_METHODS.includes(e.key[0]));
      add(prefix, segment, capitalise(segment), rows.some(e => e.key[0] !== 'GET'), rows);
    }
  }
  return [...found.values()];
};
