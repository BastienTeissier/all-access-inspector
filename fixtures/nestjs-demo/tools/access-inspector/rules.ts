// Built-in Rules, Recognition Rules and Acknowledged Unknowns; turns findings into the Core Classification.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { AUTHENTICATION, AUTHORIZATION, type Axis, type Layer, METHODS } from './inventory.js';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const AUTHENTICATION_STRICTNESS = ['required', 'unknown', 'optional', 'anonymous'];
const AUTHORIZATION_STRICTNESS = ['unknown', 'rule', 'none'];

export type Authn = (typeof AUTHENTICATION)[number];
export type Authz = (typeof AUTHORIZATION)[number];
export type Metadata = Record<string, unknown>;

/** One guard the classifier saw on an endpoint, named by its class. */
export interface Finding {
  construct: string;
  layer: Layer;
  raw: string | null;
  reason?: string; // set when the script cannot read the construct at all
}

interface Builtin {
  name: string;
  authn: Authn;
  authz: Authz;
  safeAuthn?: Authn; // value for GET/HEAD/OPTIONS when it differs
  safeAuthz?: Authz;
}

/** A Recognition Rule: maps a project guard, or every path under a prefix, onto the Core Classification. */
export interface Rule {
  name: string;
  evidence: string; // "relative/path.ts:line" of the construct the rule interprets
  authn: Authn;
  authz: Authz;
  construct?: string;
  pathPrefix?: string;
  layer?: Layer; // defaults to the finding's layer; required with pathPrefix
  raw?: string;
  safeAuthn?: Authn; // value for GET/HEAD/OPTIONS when it differs, as for a Built-in Rule
  safeAuthz?: Authz;
  whenMetadata?: Metadata; // matches only when every key equals the endpoint's handler-then-class metadata; null matches an absent key
  rawMetadata?: string; // metadata key whose value is appended to raw, e.g. 'roles'
}

/** A guard that is not access control (rate limiting, logging): it yields no finding. */
export interface Neutral {
  construct: string;
  evidence: string;
}

/** An Acknowledged Unknown: the written reason an unknown endpoint stays unknown. */
export interface Ack {
  reason: string;
  construct?: string;
  path?: string;
}

export class RuleError extends Error {}

export const PASSPORT = '@nestjs/passport.AuthGuard';
export const NO_CHECK = 'no_check';

const BUILTIN: Record<string, Builtin> = {
  [PASSPORT]: { name: 'AuthGuard', authn: 'required', authz: 'none' },
  [NO_CHECK]: { name: 'no_check', authn: 'anonymous', authz: 'none' },
};

export const BUILTIN_NEUTRAL = ['ThrottlerGuard'];

// --- project ---
// Recognition Rules. Each cites the file and line of the construct it interprets. For one construct the first
// matching rule wins, so a conditional rule precedes the default one, e.g.:
// { name: 'auth_guard_public', evidence: 'src/auth/auth.guard.ts:12', authn: 'anonymous', authz: 'none',
//   construct: 'AuthGuard', whenMetadata: { isPublic: true } },
// { name: 'auth_guard', evidence: 'src/auth/auth.guard.ts:12', authn: 'required', authz: 'none', construct: 'AuthGuard' },
export const RECOGNITION: Rule[] = [
  { name: 'session_public', evidence: 'src/auth/session.guard.ts:8', authn: 'anonymous', authz: 'none',
    construct: 'SessionGuard', whenMetadata: { isPublic: true } },
  { name: 'session', evidence: 'src/auth/session.guard.ts:8', authn: 'required', authz: 'none', construct: 'SessionGuard' },
  { name: 'roles_unset', evidence: 'src/auth/roles.guard.ts:8', authn: 'anonymous', authz: 'none',
    construct: 'RolesGuard', whenMetadata: { roles: null } },
  { name: 'roles', evidence: 'src/auth/roles.guard.ts:8', authn: 'required', authz: 'rule',
    construct: 'RolesGuard', rawMetadata: 'roles' },
  { name: 'partner_key', evidence: 'src/partner/partner-key.middleware.ts:7', authn: 'required', authz: 'none',
    pathPrefix: '/api/partner/', layer: 'global', raw: 'PartnerKeyMiddleware' },
];

// Guards that are not access control, e.g.:
// { construct: 'RequestLogGuard', evidence: 'src/logging/request-log.guard.ts:8' },
export const NEUTRAL: Neutral[] = [];

// Acknowledged Unknowns, e.g.:
// { reason: 'GraphQL operations are out of scope; authorization is enforced per resolver', path: '/graphql' },
export const ACKNOWLEDGED: Ack[] = [
  { reason: 'SignatureGuard checks a signature carried in the request body; what it admits depends on the payload',
    construct: 'SignatureGuard' },
];
// --- end project ---

export const isNeutral = (construct: string, neutral: Neutral[] = NEUTRAL): boolean =>
  BUILTIN_NEUTRAL.includes(construct) || neutral.some(n => n.construct === construct);

/**
 * All checks apply: per axis the strictest component wins, and the first one holding that value is reported.
 * Components are in request order (path rules, then findings as the classifier lists them: global, class,
 * method), so on a tie the check a request meets first is the one reported. The last item is true when an
 * Acknowledged Unknown gave the reason.
 */
export const resolveAccess = (
  findings: Finding[],
  method: string,
  path: string,
  metadata: Metadata = {},
  recognition: Rule[] = RECOGNITION,
  acknowledged: Ack[] = ACKNOWLEDGED,
): [Axis, Axis, string | null, boolean] => {
  const own = findings.map(f => component(f, method, metadata, recognition));
  const components = [
    ...recognition
      .filter(r => r.pathPrefix !== undefined && path.startsWith(r.pathPrefix) && matches(r, metadata))
      .map(r => recognised(r, method, r.layer ?? null, r.raw ?? null, metadata)),
    ...own,
  ];
  if (components.length === 0) throw new RuleError(`${method} ${path}: no finding to classify`);
  const authn = strictest(components.map(c => c[0]), AUTHENTICATION_STRICTNESS);
  const authz = strictest(components.map(c => c[1]), AUTHORIZATION_STRICTNESS);
  if (authn.value !== 'unknown' && authz.value !== 'unknown') return [authn, authz, null, false];
  const unknown = new Set(
    findings.filter((_, i) => own[i]![0].value === 'unknown' || own[i]![1].value === 'unknown').map(f => f.construct),
  );
  const ack = acknowledged.find(a => a.path === path || (a.construct !== undefined && unknown.has(a.construct)));
  if (ack !== undefined) return [authn, authz, ack.reason, true];
  const reason = findings.find(f => f.reason && unknown.has(f.construct))?.reason;
  return [authn, authz, reason ?? null, false];
};

/** An ANY endpoint whose checks differ for safe methods is split into one row per method. */
export const methods = (
  findings: Finding[],
  method: string,
  path: string,
  metadata: Metadata = {},
  recognition: Rule[] = RECOGNITION,
): string[] => {
  if (method !== 'ANY') return [method];
  const get = resolveAccess(findings, 'GET', path, metadata, recognition, []);
  const post = resolveAccess(findings, 'POST', path, metadata, recognition, []);
  return JSON.stringify(get) === JSON.stringify(post) ? [method] : METHODS.filter(m => m !== 'ANY');
};

/** Every Recognition Rule targets one thing, and every rule and Neutral guard cites a file and line that exist. */
export const checkRules = (recognition: Rule[], neutral: Neutral[], root: string): void => {
  for (const rule of recognition) {
    if ((rule.construct === undefined) === (rule.pathPrefix === undefined)) {
      throw new RuleError(`rule ${rule.name}: set exactly one of construct or pathPrefix`);
    }
    if (rule.pathPrefix !== undefined && rule.layer === undefined) {
      throw new RuleError(`rule ${rule.name}: a pathPrefix rule needs a layer`);
    }
    for (const [value, allowed] of [
      [rule.authn, AUTHENTICATION_STRICTNESS],
      [rule.safeAuthn, AUTHENTICATION_STRICTNESS],
      [rule.authz, AUTHORIZATION_STRICTNESS],
      [rule.safeAuthz, AUTHORIZATION_STRICTNESS],
    ] as const) {
      if (value !== undefined && !allowed.includes(value)) {
        throw new RuleError(`rule ${rule.name}: '${value}' is not one of ${allowed.join(', ')}`);
      }
    }
    checkEvidence(`rule ${rule.name}`, rule.evidence, root);
  }
  for (const n of neutral) checkEvidence(`neutral ${n.construct}`, n.evidence, root);
};

const checkEvidence = (owner: string, evidence: string, root: string): void => {
  const at = evidence.lastIndexOf(':');
  const [file, line] = [evidence.slice(0, Math.max(at, 0)), evidence.slice(at + 1)];
  const source = resolve(root, file);
  const inside = !relative(root, source).startsWith('..');
  if (!(file && /^\d+$/.test(line) && inside && existsSync(source) && statSync(source).isFile())) {
    throw new RuleError(`${owner}: evidence ${evidence} does not exist`);
  }
  const text = readFileSync(source, 'utf8');
  const count = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  if (Number(line) < 1 || Number(line) > count) {
    throw new RuleError(`${owner}: evidence ${evidence} is past the end of the file`);
  }
};

const matches = (rule: Rule, metadata: Metadata): boolean =>
  Object.entries(rule.whenMetadata ?? {}).every(([key, value]) => JSON.stringify(metadata[key] ?? null) === JSON.stringify(value));

const component = (finding: Finding, method: string, metadata: Metadata, recognition: Rule[]): [Axis, Axis] => {
  const rule = recognition.find(r => r.construct === finding.construct && matches(r, metadata));
  if (rule !== undefined) {
    return recognised(rule, method, rule.layer ?? finding.layer, rule.raw ?? finding.raw, metadata);
  }
  const builtin = finding.reason === undefined ? BUILTIN[finding.construct] : undefined;
  if (builtin === undefined) {
    return [axis('unknown', finding.layer, finding.raw, null), axis('unknown', finding.layer, finding.raw, null)];
  }
  const [authn, authz] = forMethod(builtin, method);
  const tag = `builtin:${builtin.name}`;
  return [axis(authn, finding.layer, finding.raw, tag), axis(authz, finding.layer, finding.raw, tag)];
};

const recognised = (rule: Rule, method: string, layer: Layer, raw: string | null, metadata: Metadata): [Axis, Axis] => {
  const [authn, authz] = forMethod(rule, method);
  const value = rule.rawMetadata === undefined ? undefined : metadata[rule.rawMetadata];
  const shown = value === undefined ? raw : `${raw ?? rule.name} ${rule.rawMetadata}=${JSON.stringify(value)}`;
  const tag = `recognition:${rule.name}`;
  return [axis(authn, layer, shown, tag, rule.evidence), axis(authz, layer, shown, tag, rule.evidence)];
};

/** GET/HEAD/OPTIONS take the safe value when the check sets one. */
const forMethod = (check: Builtin | Rule, method: string): [string, string] => {
  const safe = SAFE_METHODS.includes(method);
  return [(safe && check.safeAuthn) || check.authn, (safe && check.safeAuthz) || check.authz];
};

const axis = (value: string, layer: Layer, raw: string | null, rule: string | null, evidence: string | null = null): Axis => ({
  value,
  layer,
  raw,
  rule: value === 'unknown' ? null : rule,
  evidence: value === 'unknown' ? null : evidence,
});

const strictest = (axes: Axis[], order: string[]): Axis => {
  const winner = Math.min(...axes.map(a => order.indexOf(a.value)));
  return axes.find(a => order.indexOf(a.value) === winner)!;
};
