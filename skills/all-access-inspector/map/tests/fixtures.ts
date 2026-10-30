// Runtimes, vocabularies, roles and endpoints built in the tests: only what a case changes is spelled out.

import type { MapEndpoint } from '../src/join.ts';
import type { Role } from '../src/roles.ts';
import { type Runtime, type Who, emptyRuntime } from '../src/runtime.ts';
import type { Vocabulary } from '../src/vocabulary.ts';

export const runtime = (extra: Partial<Runtime> = {}): Runtime => ({ ...emptyRuntime('django'), ...extra });

export const vocabulary = (extra: Partial<Vocabulary> = {}): Vocabulary => ({ areas: [], roles: [], capabilities: [], ...extra });

export const role = (id: string, extra: Partial<Role> = {}): Role => ({
  id,
  name: id,
  kind: 'group',
  at: `app/roles.py:1`,
  basis: 'rule',
  doc_at: null,
  includes: [],
  staff: false,
  ...extra,
});

export const who = (kind: Who['kind'], extra: Partial<Who> = {}): Who => ({ kind, basis: 'extracted', how: kind, ...extra });

/** A map endpoint with only its key and `who`; the page fields the cells never read are left empty. */
export const endpoint = (method: string, path: string, w: Who): MapEndpoint =>
  ({ key: [method, path, 'app/views.py'], method, path, handler: 'app/views.py:1', who: w }) as MapEndpoint;
