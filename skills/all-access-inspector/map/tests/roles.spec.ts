import { describe, expect, test } from 'vitest';

import { ANONYMOUS, reach, roleList } from '../src/roles.ts';
import type { RuntimeRole } from '../src/runtime.ts';
import { role, runtime, vocabulary, who } from './fixtures.ts';

const ROLES = {
  anonymous: role(ANONYMOUS, { kind: 'anonymous' }),
  signed_in: role('member', { kind: 'signed_in' }),
  group: role('editor'),
  staffed: role('desk', { staff: true }),
  including: role('lead', { includes: ['editor'] }),
  superuser: role('root', { kind: 'superuser' }),
};

// One row per `who`, one column per role above, in the order of plan §1.
const TABLE: [string, ReturnType<typeof who>, string[]][] = [
  ['nobody', who('nobody'), ['off', 'off', 'off', 'off', 'off', 'off']],
  ['anyone', who('anyone'), ['yes', 'yes', 'yes', 'yes', 'yes', 'yes']],
  ['signed_in', who('signed_in'), ['no', 'yes', 'yes', 'yes', 'yes', 'yes']],
  ['staff', who('staff'), ['no', 'no', 'no', 'yes', 'no', 'yes']],
  ['groups', who('groups', { roles: ['editor'] }), ['no', 'no', 'yes', 'no', 'yes', 'yes']],
  ['superuser', who('superuser'), ['no', 'no', 'no', 'no', 'no', 'yes']],
  ['custom', who('custom', { basis: 'open' }), ['no', 'unresolved', 'unresolved', 'unresolved', 'unresolved', 'yes']],
  ['open basis', who('signed_in', { basis: 'open' }), ['no', 'yes', 'yes', 'yes', 'yes', 'yes']],
  ['groups, open basis', who('groups', { roles: [], basis: 'open' }), ['no', 'unresolved', 'unresolved', 'unresolved', 'unresolved', 'yes']],
];

describe('reach', () => {
  test.each(TABLE)('%s', (_, w, expected) => {
    expect(Object.values(ROLES).map(r => reach(w, r))).toEqual(expected);
  });
});

const ruled = (id: string, extra: Partial<RuntimeRole> = {}): RuntimeRole => ({
  id,
  kind: 'group',
  at: `app/roles.py:${id.length}`,
  basis: 'rule',
  includes: [],
  staff: null,
  ...extra,
});

describe('roleList', () => {
  test('not signed in first, superuser last, the rest by id, named by the vocabulary', () => {
    const rt = runtime({ roles: [ruled('admin', { kind: 'superuser' }), ruled('zeta'), ruled('alpha')] });
    const roles = roleList(rt, vocabulary({ roles: [{ id: 'alpha', name: 'Alpha team', doc_at: 'README.md:3' }] }));
    expect(roles.map(r => r.id)).toEqual([ANONYMOUS, 'alpha', 'zeta', 'admin']);
    expect(roles[1]).toMatchObject({ name: 'Alpha team', doc_at: 'README.md:3', basis: 'rule' });
  });

  test('includes are closed transitively, and staff comes through an included role', () => {
    const rt = runtime({
      roles: [
        ruled('a', { includes: [{ role: 'b', at: 'x.py:1' }] }),
        ruled('b', { includes: [{ role: 'c', at: 'x.py:2' }] }),
        ruled('c', { staff: { at: 'x.py:3' }, includes: [{ role: 'a', at: 'x.py:4' }] }),
        ruled('d'),
      ],
    });
    const roles = new Map(roleList(rt, vocabulary()).map(r => [r.id, r]));
    expect(roles.get('a')).toMatchObject({ includes: ['b', 'c'], staff: true });
    expect(roles.get('b')).toMatchObject({ includes: ['a', 'c'], staff: true });
    expect(roles.get('d')).toMatchObject({ includes: [], staff: false });
  });

  test('a role written by hand is curated', () => {
    const v = vocabulary({ roles: [{ id: 'ops', kind: 'group', at: 'docs/roles.md:2', reason: 'no introspect', staff: { at: 'docs/roles.md:3' } }] });
    expect(roleList(runtime(), v).find(r => r.id === 'ops')).toMatchObject({ basis: 'curated', staff: true });
  });
});
