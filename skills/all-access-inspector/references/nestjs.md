# NestJS reference

Tested with NestJS 12 (ESM, vitest) and NestJS 11 (CommonJS, jest), on the Express 5 adapter. Express 4 (NestJS 10 and earlier) is read too, but no fixture covers it.

## Vendor and run

Copy every file of `<skill>/base-scripts/nestjs/access_inspector/` into `tools/access-inspector/`, with `cp -L` for `VERSION`. Never copy the toolkit's `package.json`, lockfile, `tests/` or `tsconfig.json`. The project's dependencies must be installed.

`inspect.sh` runs `run.spec.ts` as a single test through the project's own runner, vitest or jest, whichever `package.json` declares. The runner gives the script the project's TypeScript transform, decorator metadata and path aliases. The project's test files, setup files, coverage and test `env` are not loaded. The package manager is read from the nearest lockfile, up to a monorepo root.

- vitest: `vitest.config.ts` loads the project's `vitest.config.*` / `vite.config.*` and keeps its `resolve` and plugins.
- jest: `jest.config.cjs` loads `jest.config.{js,cjs,mjs,json}` or the `jest` key of `package.json` and keeps its `transform` and `moduleNameMapper`. A `jest.config.ts` is not read: port its transform and mappings into `jest.config.cjs`, which is then project code to mention in the summary.

`<run>` is always `tools/access-inspector/inspect.sh` from the directory that holds the app's `package.json`. In a monorepo that is the app's package (`apps/backend`), not the repository root.

## Where access is decided, by layer

| Layer | NestJS construct | Read by the Base Script |
|---|---|---|
| `global` | `{ provide: APP_GUARD, useClass: … }`, `app.useGlobalGuards(…)` in the setup function | yes |
| `global` | middleware (`consumer.apply(…).forRoutes(…)`, `app.use(…)`) | no: write a `pathPrefix` rule |
| `class` | `@UseGuards(…)` on the controller | yes |
| `method` | `@UseGuards(…)` on the handler | yes |
| `framework-default` | no guard, or only neutral guards | yes, `builtin:no_check` |

Guards are named by their class name. Metadata (`@SetMetadata`, `Reflector.createDecorator`, `@Public()`, `@Roles()`) is read as `Reflector.getAllAndOverride` reads it: the handler's value wins over the controller's.

## Production entry

1. `ENTRY` is the root module `main.ts` passes to `NestFactory.create`, as a specifier relative to `tools/access-inspector/boot.ts`, with the `.js` extension `main.ts` imports it with (`../../src/app.module.js`).
2. `CONFIGURE` is the function `main.ts` calls on the app before `listen` (`setGlobalPrefix`, `enableVersioning`, `useGlobalGuards`, `app.use`). When `main.ts` does this inline, ask the team to extract it into an exported function first, or leave `CONFIGURE` null and say in the summary which setup the inventory misses. Never copy the setup into `boot.ts`.
3. Setup guarded by `NODE_ENV` (Swagger in non-production, a dev-only module) follows `ENVIRON`: `NODE_ENV=production` is required, and `boot.ts` refuses any other value.

## Environment

`ENVIRON` is applied before `ENTRY` is imported and overrides the shell. Pin every variable that shapes modules, guards or routes to its production value; ask when the source does not say.

`ConfigModule.forRoot()` reads `.env` files, but never overrides a variable already set: a variable pinned in `ENVIRON` wins, an unpinned one takes a developer's local value. Pin the ones that shape access. A `dotenv` call in `main.ts` does not run, since `main.ts` is not imported.

## Boot failure → stub cookbook

| Symptom | Toward-production fix |
|---|---|
| A required secret read at import or boot (`JWT_SECRET`, a schema validating `process.env`) | `Env` with a placeholder, never a real value: `{ name: 'JWT_SECRET', value: 'inventory-placeholder', reason: 'secret required at boot by src/config/env.ts' }` |
| A required non-secret value (`DATABASE_URL`, `ALLOWED_ORIGIN`) | `Env` with a production-shaped placeholder; ask the user when the value changes routes or guards |
| A provider connecting at init (`onModuleInit`, a database pool, Redis, a queue) | `Stub` its token: `{ token: DATABASE, reason: 'database unreachable outside production', value: {} }`; import the token in the project section |
| An async provider factory that needs the network | `Stub` the token the factory provides |
| A guard, controller, `APP_GUARD` or the root module | never stub: `boot.ts` refuses. Stub what the guard depends on instead |
| A module import failing (`Cannot find module`) | real code error, or a dependency missing from the install: report it |

`boot.ts` compiles the module with `@nestjs/testing` and `app.init()`s it without listening. Lifecycle hooks run, so stub what they reach.

## Built-in rules

| Construct | authentication | authorization |
|---|---|---|
| `@nestjs/passport` `AuthGuard()` / `AuthGuard('<strategy>')` | required | none |
| `ThrottlerGuard` (and its subclasses only through `NEUTRAL`) | neutral: not shown | |
| no guard | anonymous | none |

Every other guard is unknown until a Recognition Rule names it. A subclass of `AuthGuard('jwt')` written in the project is a project class: write a rule for it.

## Writing a Recognition Rule

- `construct` is the guard's class name, as `raw` shows it.
- `evidence` is the `class` line of the guard in the project, or for a package guard the project line that applies it (`APP_GUARD` provider, `@UseGuards`).
- A guard that reads metadata gets one rule per meaning, the conditional one first: `whenMetadata: { isPublic: true }` (anonymous), then the default rule (required). `whenMetadata: { roles: null }` matches when the key is absent. Values compare as JSON.
- `rawMetadata: 'roles'` appends the metadata to `raw`, e.g. `RolesGuard roles=["admin"]`, so a role change shows in the diff.
- A guard that passes reads (`if (request.method === 'GET') return true`): set `safeAuthn` / `safeAuthz`.
- A middleware enforcing a prefix: `pathPrefix: '/api/partner/'` (the full path, global prefix included), `layer: 'global'`, `raw: '<MiddlewareClass>'`, evidence on the line that rejects the request.
- A guard that is not access control (rate limiting, logging, tracing): add it to `NEUTRAL` with its evidence. It then disappears from the inventory.

Field names are camelCase in TypeScript: `pathPrefix`, `safeAuthn`, `safeAuthz`, `whenMetadata`, `rawMetadata`.

## Acknowledged Unknowns

- A guard deciding from the request body or the loaded entity (webhook signatures, ownership): acknowledge its `construct`.
- GraphQL (`/graphql`), WebSocket gateways, microservice transports: acknowledge the `path`; operations are out of scope.
- An external policy engine (CASL abilities loaded from the database, OPA): acknowledge the construct.

## Blind spots

- Middleware is not read. An endpoint behind an authenticating middleware reads its guards only. Always review `configure(consumer)` and `app.use` calls.
- Checks inside handlers or services (`if (user.role !== 'admin') throw new ForbiddenException()`) are invisible. Grep handlers flagged `anonymous` or `none` for `ForbiddenException`, `UnauthorizedException`, `request.user`.
- A guard reading metadata with `reflector.get` (handler only) or `getAllAndMerge` sees a different value than the script on an endpoint where both the controller and the handler set the key. Check such guards by hand.
- An Express 5 optional segment or wildcard (`users{/:id}`, `files{*path}`) is listed once, as if present (`/users/{id}`); the route without it shares its guards.
- Routes registered on Express outside Nest appear as unknown endpoints naming the handler function; a router mounted where the script did not see the mount path shows `{mount}`.
- With the Fastify adapter, routes registered on Fastify outside Nest are not listed: `coverage` is `best-effort`.
- An `APP_GUARD` provided with `useFactory` or `useExisting` and request-scoped is named after its factory or alias, not the guard class: write the rule for that name.
- Interceptors and pipes are not read; an interceptor that rejects requests is a blind spot like a middleware.

## Candidate dimensions

As for any stack: path prefix groups that share a guard or a middleware (`/api/admin/`, `/api/partner/`, `/webhooks/`, `/health`), roles named in rules (`roles=["admin"]` → `staff`), `@Public()` routes → `public`.

## Linters

Exclude `tools/access-inspector/` from:

- eslint: `ignores` in `eslint.config.*` (flat config) or `.eslintignore`;
- prettier: `.prettierignore`;
- tsc: the `exclude` of the `tsconfig.json` the `typecheck` script uses (the vendored files type-check under the toolkit's strict settings, not the project's);
- dependency-cruiser: `exclude.path` in `.dependency-cruiser.*`.
