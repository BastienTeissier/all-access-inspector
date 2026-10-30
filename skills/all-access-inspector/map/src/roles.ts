// The map's columns: not signed in first, the roles the code defines, superusers last; and whether one passes a `who`.

import type { Basis, Runtime, Who } from './runtime.ts';
import type { Vocabulary } from './vocabulary.ts';

export type RoleKind = 'anonymous' | 'signed_in' | 'superuser' | 'group';

export interface Role {
  id: string;
  name: string;
  kind: RoleKind;
  at: string | null;
  basis: Basis;
  doc_at: string | null;
  includes: string[]; // every role an account of this one also holds, transitively
  staff: boolean; // this role, or one it includes, passes staff checks
}

export type Reach = 'yes' | 'no' | 'off' | 'unresolved';

export const ANONYMOUS = 'anonymous';

const ORDER: Record<RoleKind, number> = { anonymous: 0, signed_in: 1, group: 1, superuser: 2 };

/** Runtime roles and hand-written ones, named by the vocabulary; `includes` closed transitively. */
export const roleList = (runtime: Runtime, vocabulary: Vocabulary): Role[] => {
  const named = new Map(vocabulary.roles.map(r => [r.id, r]));
  const declared = [
    ...runtime.roles,
    ...vocabulary.roles.flatMap(r =>
      r.kind && r.at ? [{ id: r.id, kind: r.kind, at: r.at, basis: 'curated' as const, includes: r.includes ?? [], staff: r.staff ?? null }] : [],
    ),
  ];
  const direct = new Map(declared.map(r => [r.id, r]));
  const closure = (id: string, seen = new Set<string>()): Set<string> => {
    for (const i of direct.get(id)?.includes ?? [])
      if (!seen.has(i.role)) {
        seen.add(i.role);
        closure(i.role, seen);
      }
    return seen;
  };
  const roles: Role[] = declared.map(r => {
    const includes = [...closure(r.id)].filter(i => i !== r.id).sort();
    return {
      id: r.id,
      name: named.get(r.id)?.name ?? r.id,
      kind: r.kind,
      at: r.at,
      basis: r.basis,
      doc_at: named.get(r.id)?.doc_at ?? null,
      includes,
      staff: [r.id, ...includes].some(i => direct.get(i)?.staff),
    };
  });
  const anonymous: Role = { id: ANONYMOUS, name: 'Not signed in', kind: 'anonymous', at: null, basis: 'extracted', doc_at: null, includes: [], staff: false };
  return [anonymous, ...roles].sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};

/** Whether one role passes one endpoint's `who`, in the order of plan §1. */
export const reach = (who: Who, role: Role): Reach => {
  if (who.kind === 'nobody') return 'off';
  if (role.kind === 'superuser' || who.kind === 'anyone') return 'yes';
  if (role.kind === 'anonymous') return 'no';
  if (who.kind === 'signed_in') return 'yes';
  if (who.kind === 'staff') return role.staff ? 'yes' : 'no';
  if (who.kind === 'groups' && [role.id, ...role.includes].some(r => who.roles?.includes(r))) return 'yes';
  if (who.kind === 'custom' || who.basis === 'open') return 'unresolved';
  return 'no'; // superuser only
};
