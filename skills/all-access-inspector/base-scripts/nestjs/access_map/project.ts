// Map Rules: the facts this project declares in a form a program can read, each with its file:line.
//
// Read before you write: a role, scope or capability the code declares goes here, never in vocabulary.json. Every
// rule returns plain objects, each with `at` (`path:line` from the project root, found with `lineOf`). The
// introspect adds basis `rule` to them, `inferred` to scopes.
//
// Project code goes only in the project section. Everything else stays byte-identical to the Base Script.

import { ROOT } from '../access-inspector/boot.js';
import { type Fact, lineOf } from './runtime.js';

export { ROOT, lineOf };
export type { Fact };

// --- project ---
// Directories whose classes and functions are the project's own handlers.
export const FIRST_PARTY: string[] = ['src'];

// Recognition Rules (tools/access-inspector/rules.ts names) that let through a relation to the record (its
// creator, the holder of an API key): rule name -> the ids of the `relation` roles roles() declares.
export const RELATION_RULES: Record<string, string[]> = {};

/**
 * Roles: {id, kind: group|signed_in|relation, at}. Every role a roles guard names (a Recognition Rule with
 * rawMetadata, e.g. @Roles('admin')) must be declared here. The signed-in role is read from the Recognition Rules;
 * declare it when the app signs in only through passport's AuthGuard. A `relation` role
 * is a relation to the record a check tests, `at` the line of the check; RELATION_RULES names the rules that let
 * it through.
 *
 * One group per value of a role enum (`import { Role } from '../../src/auth/role.enum.js';` in this section):
 *   return Object.values(Role).map(r => ({ id: r, kind: 'group', at: lineOf(ROOT, 'src/auth/role.enum.ts', `'${r}'`) }));
 */
export const roles = (): Fact[] => [];

/**
 * {role, includes, at}: every account of `role` also holds `includes`.
 *
 * An admin who passes every editor check:
 *   return [{ role: 'admin', includes: 'editor', at: lineOf(ROOT, 'src/auth/roles.guard.ts', "role === 'admin'") }];
 */
export const includes = (): Fact[] => [];

/**
 * {id, label, at}: a filter on which records a role sees.
 *
 * A repository query filtered on the caller's company:
 *   return [{ id: 'own-company', label: 'Own company', at: lineOf(ROOT, 'src/orders/orders.service.ts', 'companyId: user.companyId') }];
 */
export const scopes = (): Fact[] => [];

/**
 * {capability, role, scope, at}: `scope` narrows `capability` for `role`.
 *
 * The order list, filtered by company for every non-admin:
 *   const at = lineOf(ROOT, 'src/orders/orders.service.ts', 'companyId: user.companyId');
 *   return [{ capability: 'resource.orders.read', role: 'user', scope: 'own-company', at }];
 */
export const scoped = (): Fact[] => [];

/**
 * {id, area, term, verb: read|write, endpoints: [[method, path, handler]], check, at}.
 *
 * First-party endpoints are grouped into resources already. A report two routes serve:
 *   return [{
 *     id: 'export-orders', area: 'orders', term: 'Order', verb: 'read',
 *     endpoints: [['GET', '/api/orders/export', 'OrdersController.export']],
 *     check: "@Roles('admin')", at: lineOf(ROOT, 'src/orders/orders.controller.ts', 'export('),
 *   }];
 */
export const capabilities = (): Fact[] => [];
// --- end project ---
