import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { type Finding, NO_CHECK, PASSPORT, type Rule, RuleError, checkRules, isNeutral, methods, resolveAccess } from '../access_inspector/rules.js';

const passport: Finding = { construct: PASSPORT, layer: 'global', raw: "AuthGuard('jwt')" };
const roles: Finding = { construct: 'RolesGuard', layer: 'method', raw: 'RolesGuard' };
const none: Finding = { construct: NO_CHECK, layer: 'framework-default', raw: null };
const rule = (over: Partial<Rule>): Rule => ({ name: 'r', evidence: 'src/a.ts:1', authn: 'required', authz: 'none', ...over });

describe('resolveAccess', () => {
  test('passport is a builtin', () => {
    const [authn, authz, reason] = resolveAccess([passport], 'GET', '/me', {}, [], []);
    expect(authn).toEqual({ value: 'required', layer: 'global', raw: "AuthGuard('jwt')", rule: 'builtin:AuthGuard', evidence: null });
    expect(authz.value).toBe('none');
    expect(reason).toBeNull();
  });

  test('no check is anonymous', () => {
    const [authn, authz] = resolveAccess([none], 'GET', '/', {}, [], []);
    expect([authn.value, authz.value, authn.rule]).toEqual(['anonymous', 'none', 'builtin:no_check']);
  });

  test('a custom guard is unknown until a rule names it', () => {
    const [authn, authz] = resolveAccess([passport, roles], 'GET', '/admin', {}, [], []);
    expect(authn.value).toBe('required');
    expect(authz).toEqual({ value: 'unknown', layer: 'method', raw: 'RolesGuard', rule: null, evidence: null });
  });

  test('a recognised guard with its metadata in raw', () => {
    const recognition = [rule({ name: 'roles', construct: 'RolesGuard', authz: 'rule', rawMetadata: 'roles' })];
    const [, authz] = resolveAccess([passport, roles], 'GET', '/admin', { roles: ['admin'] }, recognition, []);
    expect(authz).toEqual({ value: 'rule', layer: 'method', raw: 'RolesGuard roles=["admin"]', rule: 'recognition:roles', evidence: 'src/a.ts:1' });
  });

  test('whenMetadata precedes the default rule', () => {
    const guard: Finding = { construct: 'AuthGuard', layer: 'global', raw: 'AuthGuard' };
    const recognition = [
      rule({ name: 'public', construct: 'AuthGuard', authn: 'anonymous', whenMetadata: { isPublic: true } }),
      rule({ name: 'auth', construct: 'AuthGuard' }),
    ];
    expect(resolveAccess([guard], 'GET', '/', { isPublic: true }, recognition, [])[0].rule).toBe('recognition:public');
    expect(resolveAccess([guard], 'GET', '/', { isPublic: false }, recognition, [])[0].rule).toBe('recognition:auth');
    expect(resolveAccess([guard], 'GET', '/', {}, recognition, [])[0].value).toBe('required');
  });

  test('null matches an absent metadata key', () => {
    const recognition = [
      rule({ name: 'no_roles', construct: 'RolesGuard', whenMetadata: { roles: null } }),
      rule({ name: 'roles', construct: 'RolesGuard', authz: 'rule' }),
    ];
    expect(resolveAccess([roles], 'GET', '/', {}, recognition, [])[1].rule).toBe('recognition:no_roles');
    expect(resolveAccess([roles], 'GET', '/', { roles: ['admin'] }, recognition, [])[1].rule).toBe('recognition:roles');
  });

  test('safe methods', () => {
    const recognition = [rule({ name: 'ro', construct: 'RolesGuard', authz: 'rule', safeAuthn: 'optional', safeAuthz: 'none' })];
    const get = resolveAccess([roles], 'GET', '/a', {}, recognition, []);
    const post = resolveAccess([roles], 'POST', '/a', {}, recognition, []);
    expect([get[0].value, get[1].value]).toEqual(['optional', 'none']);
    expect([post[0].value, post[1].value]).toEqual(['required', 'rule']);
  });

  test('a path prefix rule applies first and wins ties', () => {
    const recognition = [rule({ name: 'partner', pathPrefix: '/api/partner', layer: 'global', raw: 'PartnerKeyMiddleware' })];
    const [authn] = resolveAccess([passport], 'GET', '/api/partner/x', {}, recognition, []);
    expect(authn.rule).toBe('recognition:partner');
    expect(resolveAccess([none], 'GET', '/api/public', {}, recognition, [])[0].value).toBe('anonymous');
  });

  test('acknowledged by construct, then by path', () => {
    const ack = [{ reason: 'reads the body', construct: 'RolesGuard' }, { reason: 'out of scope', path: '/graphql' }];
    expect(resolveAccess([roles], 'POST', '/a', {}, [], ack).slice(2)).toEqual(['reads the body', true]);
    expect(resolveAccess([{ ...roles, construct: 'X' }], 'POST', '/graphql', {}, [], ack).slice(2)).toEqual(['out of scope', true]);
    expect(resolveAccess([{ ...roles, construct: 'X' }], 'POST', '/b', {}, [], ack).slice(2)).toEqual([null, false]);
  });

  test('an unreadable finding carries its reason', () => {
    const express: Finding = { construct: 'legacy', layer: null, raw: 'legacy', reason: 'mounted on Express outside Nest' };
    const [authn, , reason] = resolveAccess([express], 'ANY', '/legacy', {}, [], []);
    expect([authn.value, reason]).toEqual(['unknown', 'mounted on Express outside Nest']);
  });

  test('no finding', () => expect(() => resolveAccess([], 'GET', '/', {}, [], [])).toThrow(RuleError));
});

test('methods splits ANY only when safe methods differ', () => {
  const recognition = [rule({ name: 'ro', construct: 'RolesGuard', safeAuthn: 'optional' })];
  expect(methods([roles], 'ANY', '/a', {}, recognition)).toEqual(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']);
  expect(methods([passport], 'ANY', '/a', {}, [])).toEqual(['ANY']);
  expect(methods([roles], 'GET', '/a', {}, recognition)).toEqual(['GET']);
});

test('ThrottlerGuard and declared guards are neutral', () => {
  expect(isNeutral('ThrottlerGuard', [])).toBe(true);
  expect(isNeutral('RequestLogGuard', [{ construct: 'RequestLogGuard', evidence: 'x:1' }])).toBe(true);
  expect(isNeutral('RolesGuard', [])).toBe(false);
});

describe('checkRules', () => {
  const root = mkdtempSync(join(tmpdir(), 'rules-'));
  writeFileSync(join(root, 'guard.ts'), 'a\nb\n');

  test('valid', () => checkRules([rule({ construct: 'X', evidence: 'guard.ts:2' })], [{ construct: 'N', evidence: 'guard.ts:1' }], root));

  test.each<[Partial<Rule>, string]>([
    [{ construct: 'X', pathPrefix: '/a', layer: 'global' }, 'exactly one of construct or pathPrefix'],
    [{}, 'exactly one of construct or pathPrefix'],
    [{ pathPrefix: '/a' }, 'needs a layer'],
    [{ construct: 'X', authn: 'sso' as never }, "'sso' is not one of"],
    [{ construct: 'X', safeAuthz: 'admin' as never }, "'admin' is not one of"],
    [{ construct: 'X', evidence: 'missing.ts:1' }, 'does not exist'],
    [{ construct: 'X', evidence: '../guard.ts:1' }, 'does not exist'],
    [{ construct: 'X', evidence: 'guard.ts' }, 'does not exist'],
    [{ construct: 'X', evidence: 'guard.ts:3' }, 'past the end of the file'],
    [{ construct: 'X', evidence: 'guard.ts:0' }, 'past the end of the file'],
  ])('%j', (over, message) => {
    const { construct, pathPrefix, ...rest } = over;
    const r: Rule = { ...rule(rest), evidence: over.evidence ?? 'guard.ts:1' };
    if (construct !== undefined) r.construct = construct;
    if (pathPrefix !== undefined) r.pathPrefix = pathPrefix;
    expect(() => checkRules([r], [], root)).toThrow(message);
  });

  test('neutral evidence', () => expect(() => checkRules([], [{ construct: 'N', evidence: 'nope.ts:1' }], root)).toThrow('neutral N'));
});
