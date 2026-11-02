# UF24: A NestJS Map Introspect

**Notion ticket:** *(not requested)*

## Context

On NestJS every map fact is hand-written and a route behind `@Roles()` stays "not resolved". The project's test runner can boot the application module, as the inventory script already does; from there the roles enum, the roles guard, the sign-in strategy and the per-route metadata are readable. The Django introspect is the pattern: byte-stable `runtime.json`, `--check`, evidence as `file:line`.

## Specification

AAU (Agent), on a NestJS project I vendor `tools/access-map/` from the base script, run it through the project's test runner, and the Roles tab resolves role-guarded routes.

- roles: each member of the enum passed to `@Roles()` becomes a `group` role with `at` the enum member's line; a role named by a string literal only is left to a Map Rule `roles()` with evidence
- what sign-in grants: the strategy or guard that sets `request.user` gives `signed_in`; a `roles` field on the user it builds gives each role's `includes` when the code states them (an admin role implying the others)
- per-route who: a route with `@Roles(A, B)` under the roles guard has who `groups [A, B]`; `@Public()` or no guard keeps `anyone`; a guard other than roles and public is `custom`, with its class and line
- a policy map or CASL ability factory, when present, gives `relation` roles through `RELATION_RULES`, as on Django
- capabilities come from derived resources (UF20) and Map Rules; the introspect writes none
- `runtime.json` is byte-stable and `--check` exits 1 on a difference, 0 otherwise

## Success Scenario

- AAU, on `fixtures/nestjs-demo`, I see the roles Not signed in, User and Admin, with no superuser column; `/admin/users` resolves to Admin pass, User no; `--check` exits 0 after the build.
- AAU, I change a `@Roles()` decorator in the fixture, run `--check`, it exits 1 naming the route.

## Error Scenario

- AAU, the roles guard reads roles from a source the introspect cannot follow (a database lookup): the routes it guards are `custom`, listed under "Not resolved", with the guard's line; a Map Rule resolves them.

## Edge Cases

- AAU, a global guard registered through `APP_GUARD` applies to every route that has no `@Public()`; the introspect reads the global provider.
- AAU, a controller-level `@Roles()` applies to every method without its own.
- AAU, a route under two guards (roles and tenant) is `groups` for the roles and carries the tenant guard as a `relation` or `custom` check.
- AAU, a project with no `@Roles()` at all has no group role; the Roles tab shows Not signed in and Signed in only.

## Acceptance Criteria

- [ ] `base-scripts/nestjs/access_map/` ships with the skill; `references/nestjs.md` "Map introspect" says how to vendor and run it.
- [ ] `fixtures/nestjs-demo/expected/runtime.json` is a golden; the fixture's CI runs `--check`.
- [ ] `runtime.json` validates against `schema/runtime.schema.json`.
- [ ] A CLI scenario builds the Nest map and asserts the resolved cells.
