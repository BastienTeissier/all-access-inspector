# UF10: Inventory a NestJS project

**Notion ticket:** *(not requested)*

## Context

A developer or auditor wants the same inventory for a NestJS API. No NestJS tool exists today. Nest builds its route table and its guards at boot, so the Base Script boots the application module without listening and reads them from Nest itself. Acceptance on a real project is the fitting of `~/Theodo/bootstrap-test` (`apps/backend`).

## Specification

AAU (developer, with the project's Node toolchain installed), running the NestJS Base Script (`tools/access-inspector/inspect.sh`, which runs a test-scoped harness through the project's own test runner, vitest or jest, and writes `tools/access-inspector/inventory.json`), I see:
- every route Nest mounts, one endpoint per HTTP method and path, with the global prefix, versioning and `RouterModule` paths applied as Nest applies them; `@All()` as `ANY`; `HEAD` beside every `GET`
- the handler as `ControllerClass.method`, no line (the runtime carries no source location)
- the global layer from guards registered as `APP_GUARD` or with `useGlobalGuards`, the class layer from `@UseGuards` on the controller, the method layer from `@UseGuards` on the handler, all of them recorded in request order
- a guard that reads route metadata (`@Public()`, `@Roles(...)`) classified per endpoint from that metadata, read the way the guard reads it
- built-in rules for `@nestjs/passport`'s `AuthGuard(...)` (`required`) and for routes with no guard (`anonymous` at `framework-default`); `ThrottlerGuard` ignored as not access control; any other guard `unknown` until a Recognition Rule names it
- routes mounted on the HTTP adapter outside Nest (`app.use(...)` routers) listed as `unknown` with a reason
- `stack: nestjs`, `discovery_mode: runtime`, `coverage: complete`

## Success Scenario

- AAU, an `APP_GUARD` `AuthGuard` lets `@Public()` routes through and requires a bearer token elsewhere, with two Recognition Rules on it (public metadata, then default), I see public routes `anonymous` and the others `required`, both at layer `global`.
- AAU, a handler carries `@Roles('admin')` (`SetMetadata` + `UseGuards(RolesGuard)`), I see authorization `rule` at layer `method` with the roles in the raw field.
- AAU, the application sets a global prefix `api` excluding `health`, I see `/api/users` and `/health/live`.

## Error Scenario

- AAU, the module fails to boot (environment validation, a provider connecting at init), I see the error and the entry module, and no inventory is written.
- AAU, the project's test runner is neither vitest nor jest, I see the script stop and say so.

## Edge Cases

- AAU, if a route is protected only by a middleware (`MiddlewareConsumer.forRoutes`), I see it `anonymous` until a `path_prefix` Recognition Rule covers it.
- AAU, if a guard reads the request body or calls a service to decide, I see `unknown` until a Recognition Rule or an Acknowledged Unknown settles it.
- AAU, if the application uses the Fastify adapter, I see every Nest route; routes registered on Fastify directly are not listed, and the reference says so.

## Acceptance Criteria

- [ ] The NestJS fixture (global guard with public metadata, class and method guards, passport `AuthGuard`, roles metadata, `ThrottlerGuard`, unguarded controller, `@All()`, global prefix with exclusion, URI versioning, `RouterModule`, a route mounted outside Nest, a guarding middleware) matches its golden inventory byte for byte.
- [ ] The jest smoke fixture writes the inventory through jest.
- [ ] A custom guard without a rule yields `unknown`.
- [ ] `bootstrap-test` is fitted: `--unknowns` empty, `--check` green.
