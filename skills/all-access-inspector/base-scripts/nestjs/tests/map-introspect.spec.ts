import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test, vi } from 'vitest';

import type { Axis } from '../access_inspector/inventory.js';
import type { Rule } from '../access_inspector/rules.js';
import { type Row, build, firstParty, roles, verdict } from '../access_map/introspect.js';
import type { Fact } from '../access_map/runtime.js';

const rules = vi.hoisted(() => ({
  roles: [] as Fact[],
  includes: [] as Fact[],
  staff: [] as Fact[],
  grants: [] as Fact[],
  scopes: [] as Fact[],
  scoped: [] as Fact[],
  capabilities: [] as Fact[],
}));
vi.mock('../access_map/project.js', () => ({
  FIRST_PARTY: [],
  RELATION_RULES: {},
  roles: () => rules.roles,
  includes: () => rules.includes,
  staff: () => rules.staff,
  grants: () => rules.grants,
  scopes: () => rules.scopes,
  scoped: () => rules.scoped,
  capabilities: () => rules.capabilities,
}));

beforeEach(() => {
  for (const key of Object.keys(rules) as (keyof typeof rules)[]) rules[key] = [];
});

const RECOGNITION: Rule[] = [
  { name: 'session', evidence: 'src/auth/session.guard.ts:8', authn: 'required', authz: 'none', construct: 'SessionGuard' },
  { name: 'roles', evidence: 'src/auth/roles.guard.ts:8', authn: 'required', authz: 'rule', construct: 'RolesGuard', rawMetadata: 'roles' },
  { name: 'partner_key', evidence: 'src/partner/key.ts:7', authn: 'required', authz: 'none', pathPrefix: '/partner/', layer: 'global' },
];

const axis = (value: string, rule: string | null): Axis => ({ value, layer: 'class', raw: 'r', rule, evidence: null });

const row = (authz: Axis, metadata = {}, authn = axis('required', 'recognition:session')): Row => ({
  method: 'GET',
  path: '/users',
  handler: 'UsersController.list',
  authentication: authn,
  authorization: authz,
  metadata,
});

const guarded = (roles: unknown) => row({ ...axis('rule', 'recognition:roles'), raw: `RolesGuard roles=${JSON.stringify(roles)}` }, { roles });

test('a roles guard lets through the roles its metadata names', () => {
  expect(verdict(guarded(['b', 'a', 'a']), RECOGNITION, {})).toEqual({
    kind: 'groups',
    roles: ['a', 'b'],
    basis: 'extracted',
    how: 'roles: RolesGuard roles=["b","a","a"]',
  });
  expect(verdict(guarded('admin'), RECOGNITION, {})).toMatchObject({ kind: 'groups', roles: ['admin'] });
});

test('no verdict without role metadata, or when another check decides', () => {
  expect(verdict(guarded(undefined), RECOGNITION, {})).toBeNull();
  expect(verdict(guarded([]), RECOGNITION, {})).toBeNull();
  expect(verdict(guarded([1]), RECOGNITION, {})).toBeNull();
  expect(verdict(row(axis('none', 'recognition:session')), RECOGNITION, {})).toBeNull();
  expect(verdict(row(axis('rule', 'builtin:AuthGuard'), { roles: ['a'] }), RECOGNITION, {})).toBeNull();
});

test('a relation rule on either axis lets through its relation roles', () => {
  const key = axis('required', 'recognition:partner_key');
  const relations = { partner_key: ['partner', 'agent'] };
  expect(verdict(row(axis('none', 'recognition:session'), {}, key), RECOGNITION, relations)).toEqual({
    kind: 'relations',
    roles: ['agent', 'partner'],
    basis: 'rule',
    how: 'Recognition rule partner_key (src/partner/key.ts:7)',
  });
  expect(verdict(row(axis('none', 'recognition:partner_key')), RECOGNITION, relations)).toMatchObject({ kind: 'relations' });
});

test('the signed-in role sits at the first rule an endpoint requires sign-in by, never a relation rule', () => {
  rules.roles = [{ id: 'admin', kind: 'group', at: 'src/a.ts:3' }];
  rules.includes = [
    { role: 'admin', includes: 'user', at: 'src/a.ts:9' },
    { role: 'admin', includes: 'editor', at: 'src/a.ts:9' },
  ];
  const found = [row(axis('none', 'recognition:session'), {}, axis('required', 'recognition:partner_key'))];
  expect(roles(found, RECOGNITION)).toEqual([
    {
      id: 'admin',
      kind: 'group',
      at: 'src/a.ts:3',
      basis: 'rule',
      includes: [
        { role: 'editor', at: 'src/a.ts:9' },
        { role: 'user', at: 'src/a.ts:9' },
      ],
      staff: null,
    },
    { id: 'user', kind: 'signed_in', at: 'src/partner/key.ts:7', basis: 'rule', includes: [], staff: null },
  ]);
  expect(roles(found, RECOGNITION, { partner_key: ['partner'] }).map(r => r.id)).toEqual(['admin']);
  expect(roles([row(axis('none', 'builtin:AuthGuard'), {}, axis('required', 'builtin:AuthGuard'))], RECOGNITION).map(r => r.id)).toEqual(['admin']);
  rules.roles = [{ id: 'member', kind: 'signed_in', at: 'src/a.ts:1' }];
  rules.includes = [];
  expect(roles(found, RECOGNITION).map(r => r.id)).toEqual(['member']);
});

test('staff() marks a role, grants() gives each permission its holders', () => {
  rules.roles = [{ id: 'admin', kind: 'group', at: 'src/a.ts:3' }];
  rules.staff = [{ role: 'admin', at: 'src/a.ts:5' }];
  rules.grants = [
    { permission: 'users.delete', role: 'admin', at: 'src/p.ts:2' },
    { permission: 'users.read', role: 'admin', at: 'src/p.ts:2' },
    { permission: 'users.read', role: 'user', at: 'src/p.ts:3' },
  ];
  const runtime = build([], '0.5.0', RECOGNITION);
  expect(runtime.roles).toMatchObject([{ id: 'admin', staff: { at: 'src/a.ts:5' } }]);
  expect(runtime.grants).toEqual({
    'users.delete': [{ role: 'admin', at: 'src/p.ts:2' }],
    'users.read': [
      { role: 'admin', at: 'src/p.ts:2' },
      { role: 'user', at: 'src/p.ts:3' },
    ],
  });
});

test('a Map Rule fact without its keys, or including an undeclared role, is refused', () => {
  rules.roles = [{ id: 'admin', kind: 'group' }];
  expect(() => roles([], RECOGNITION)).toThrow('roles() returned {"id":"admin","kind":"group"} without at');
  rules.roles = [];
  rules.includes = [{ role: 'admin', includes: 'user', at: 'src/a.ts:1' }];
  expect(() => roles([], RECOGNITION)).toThrow("includes(): no role 'admin'");
  rules.includes = [];
  rules.staff = [{ role: 'admin', at: 'src/a.ts:1' }];
  expect(() => roles([], RECOGNITION)).toThrow("staff(): no role 'admin'");
  rules.staff = [];
  rules.grants = [{ permission: 'users.read', role: 'admin' }];
  expect(() => build([], '0.5.0', RECOGNITION)).toThrow('grants() returned {"permission":"users.read","role":"admin"} without at');
});

test('first-party handlers are the classes and functions declared under the FIRST_PARTY directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'first-party-'));
  mkdirSync(join(root, 'src/users'), { recursive: true });
  mkdirSync(join(root, 'src/node_modules'), { recursive: true });
  writeFileSync(join(root, 'src/users/users.controller.ts'), 'export class UsersController {}\n');
  writeFileSync(join(root, 'src/app.ts'), 'router.get("/", function legacyStatus() {});\n');
  writeFileSync(join(root, 'src/node_modules/vendor.ts'), 'export class VendorController {}\n');
  const handlers = ['UsersController.show', 'legacyStatus', 'VendorController.list', 'UsersController.list', 'UsersController.list'];
  expect(firstParty(handlers, root, ['src', 'missing'])).toEqual(['UsersController.list', 'UsersController.show', 'legacyStatus']);
});

test('the runtime holds only endpoints with a verdict, a role roles() does not declare included', () => {
  rules.roles = [{ id: 'admin', kind: 'group', at: 'src/a.ts:3' }];
  const runtime = build([guarded(['admin']), row(axis('none', 'recognition:session'))], '0.5.0', RECOGNITION);
  expect(runtime.endpoints).toEqual([
    {
      method: 'GET',
      path: '/users',
      handler: 'UsersController.list',
      layers: [],
      permissions: [],
      verdict: expect.objectContaining({ kind: 'groups', roles: ['admin'] }),
      fallback: null,
      notes: [],
    },
  ]);
  expect(runtime).toMatchObject({ stack: 'nestjs', base_script: { stack: 'nestjs', version: '0.5.0' }, grants: {}, areas: [] });
  expect(build([guarded(['admin', 'owner'])], '0.5.0', RECOGNITION).endpoints).toMatchObject([{ verdict: { roles: ['admin', 'owner'] } }]);
});
