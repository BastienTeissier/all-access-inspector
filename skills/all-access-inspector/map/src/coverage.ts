// Coverage: which endpoints a capability lists, per area, and the gaps: first-party named, third-party counted per package.

import type { Key } from '../../review/src/inventory.ts';
import type { Capability } from './cells.ts';
import type { MapEndpoint } from './join.ts';
import type { Domain } from './vocabulary.ts';

export interface CoverageArea {
  id: string;
  name: string;
  covered: number;
  total: number;
  gaps: Key[]; // first-party endpoints behind no capability
}

export interface Coverage {
  covered: number;
  total: number;
  areas: CoverageArea[];
  third_party: { total: number; packages: { name: string; count: number; endpoints: Key[] }[] };
  unnamed: string[]; // capability ids still named by their id, in unfolded areas
  untermed: string[]; // unfolded areas holding capabilities and no term
}

/** A Coverage line of the Alerts tab and a gap filter of the Routes tab. */
export interface Gap {
  id: string;
  name: string;
  endpoints: Key[];
}

export interface CoverageInput {
  areas: { id: string; name: string; term: string | null; folded: boolean; capabilities: Capability[] }[];
  found: { cap: Capability; found: MapEndpoint[] }[];
  endpoints: MapEndpoint[];
  domains: Domain[] | undefined;
  firstParty: (handler: string) => boolean;
}

export const NO_AREA = 'no area';

/** A third-party handler's package: its first dotted segment, a `django.contrib` app by the app's name. */
export const packageOf = (handler: string): string => {
  const parts = handler.split('.');
  return parts[0] === 'django' && parts[1] === 'contrib' && parts[2] ? parts[2] : (parts[0] as string);
};

/** A path up to its first parameter: `/admin/shop/order/{id}/change/` is under `/admin/shop/order/`. */
const prefixOf = (path: string): string => {
  const i = path.indexOf('{');
  return i < 0 ? path : path.slice(0, i);
};

const under = (path: string, prefix: string): boolean => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);

/** Each area's first-party gaps, then the third-party handlers: no endpoint in two of them. */
export const gaps = (c: Coverage): Gap[] => [
  ...c.areas.filter(a => a.gaps.length).map(a => ({ id: a.id, name: a.name, endpoints: a.gaps })),
  ...(c.third_party.total ? [{ id: 'third-party', name: 'Third-party handlers', endpoints: c.third_party.packages.flatMap(p => p.endpoints) }] : []),
];

export const coverage = ({ areas, found, endpoints, domains, firstParty }: CoverageInput): Coverage => {
  const covered = new Set(found.flatMap(f => f.found));
  const byArea = new Map<string, Set<MapEndpoint>>();
  for (const f of found) {
    const set = byArea.get(f.cap.area) ?? new Set();
    for (const e of f.found) set.add(e);
    byArea.set(f.cap.area, set);
  }
  // A gap belongs to the area whose covered paths share its longest prefix, else to its domain, else to no area.
  // A bare `/` (the root, or a path that opens on a parameter) is under every path: it owns no gap.
  const prefixes = [...byArea].flatMap(([area, set]) => [...set].map(e => ({ area, prefix: prefixOf(e.path) }))).filter(p => p.prefix !== '/');
  const gapsOf = new Map<string, MapEndpoint[]>();
  for (const e of endpoints.filter(e => !covered.has(e))) {
    const owner =
      prefixes.filter(p => under(e.path, p.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]?.area ?? e.domain ?? NO_AREA;
    gapsOf.set(owner, gapsOf.get(owner) ?? []).get(owner)?.push(e);
  }
  const line = (id: string, name: string): CoverageArea => {
    const gaps = gapsOf.get(id) ?? [];
    const c = byArea.get(id)?.size ?? 0;
    return { id, name, covered: c, total: c + gaps.length, gaps: gaps.filter(e => firstParty(e.handler)).map(e => e.key) };
  };
  const listed = areas.filter(a => a.capabilities.length);
  const rest = [...gapsOf.keys()].filter(id => !listed.some(a => a.id === id)).sort((a, b) => Number(a === NO_AREA) - Number(b === NO_AREA));
  const thirdParty = endpoints.filter(e => !covered.has(e) && !firstParty(e.handler));
  const packages = new Map<string, Key[]>();
  for (const e of thirdParty) {
    const name = packageOf(e.handler);
    packages.set(name, packages.get(name) ?? []).get(name)?.push(e.key);
  }
  const unfolded = areas.filter(a => !a.folded);
  return {
    covered: covered.size,
    total: endpoints.length,
    areas: [
      ...listed.map(a => line(a.id, a.name)),
      ...rest.map(id => line(id, domains?.find(d => d.id === id)?.name ?? id)),
    ],
    third_party: {
      total: thirdParty.length,
      packages: [...packages].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, keys]) => ({ name, count: keys.length, endpoints: keys })),
    },
    unnamed: unfolded.flatMap(a => a.capabilities.filter(c => c.name === c.id).map(c => c.id)),
    untermed: unfolded.filter(a => a.capabilities.length && !a.term).map(a => a.id),
  };
};
