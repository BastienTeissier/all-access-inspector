# Unsupported stack reference

Read this when step 1 of `SKILL.md` finds no shipped Base Script for the project's stack. You then improvise an Adapted Script from the closest Base Script. Its guarantee is weaker, and the inventory says so: `coverage` is always `best-effort`.

## Pick the closest Base Script

Choose by language first, then by how the framework routes and decides access. Say which Base Script you picked and why.

| Project stack | Closest Base Script | Why |
|---|---|---|
| FastAPI, Flask, Starlette, Litestar, Pyramid | `django` | Python. The app object boots in-process, and access lives in decorators and dependencies on the view |
| Express, Fastify, Koa, Hono, NestJS on Fastify without the Nest router | `nestjs` | TypeScript/JavaScript. An app object holds a route stack, and access lives in middleware and guards per route |
| Micronaut, Quarkus, Jakarta EE (JAX-RS), Ktor | `spring` | JVM. Run from the project's test classpath, with annotations on resource methods and a security filter in front |
| Laravel, Slim, Laminas, CakePHP | `symfony` | PHP. The kernel boots in-process, and a router plus middleware groups decide access |
| Anything else (Rails, ASP.NET Core, Go, Phoenix…) | the Base Script of the closest routing shape | the kept files carry over, translated into the project's language; the extended and rewritten files are written for the stack, as § What stays and what you write lists them |

A Base Script in another language than the project's is a template to translate, never one to run beside it.

## What stays and what you write

Every file of the chosen Base Script falls in exactly one of three lists. Translate a file only when the language differs.

**Kept** byte-identical, so a refresh can replace it:
- the inventory module (canonical JSON, `--check` diff, validation);
- the rules engine (strictest wins, Recognition Rules with evidence, Acknowledged Unknowns), meaning everything in the rules file except its Built-in Rules table;
- dimensions;
- the table.

**Extended in place**: the file stays, plus edits a refresh must carry over:
- the Built-in Rules table. The Base Script's Built-in Rules name its own framework's checks. Leave them in place, since they never match another framework's constructs, and add the improvised stack's builtins beside them. `no_check`, the builtin for a route with no check, carries over as is;
- the entry. Its command-line contract stays: `--check | --table | --unknowns`, exits 0 / 1 / 2, `tools/access-inspector/inventory.json`. Only the identity fields `build()` writes change: `stack`, `coverage`, `coverage_note`, and `discovery_mode` when static.

**Rewritten** for the stack:
- **boot**: load the production app object the way production does (`ENTRY`, `ENVIRON`, stubs under the same toward-production rule);
- **discovery**: enumerate the framework's route registry (§ Route registries);
- **classify**: turn each route's checks into findings: the dependency, decorator, middleware or guard, with its layer;
- **path conversion** (`paths.py` in `django`): turn the framework's path syntax into the inventory format, a leading `/` and parameters as `{name}`;
- **the builtins** added above, each one read from the framework's source or documentation, never guessed.

The schema (`<skill>/schema/inventory.schema.json`) is the contract: the improvised inventory must validate against it.

Start every rewritten and every extended file with a comment naming the Base Script, its version and what changed: `# Improvised from the django Base Script 0.3.0 for FastAPI: discovery and classify read app.routes and Depends()`, or `# Extended from the django Base Script 0.3.0 for FastAPI: builtins fastapi_security, fastapi_http_bearer`. A later refresh relies on it.

In the inventory:
- `stack` is the project's framework (`fastapi`).
- `base_script.stack` is the Base Script it derives from (`django`), with that script's `VERSION`.
- `discovery_mode` is `runtime` when the route registry was enumerated, `static` otherwise.
- `coverage` is `best-effort`, whatever the discovery mode. Never `complete`.
- `coverage_note` names the stack, the Base Script it derives from and what it does not see, e.g. `FastAPI improvised from the django Base Script 0.3.0; app.routes read at runtime; middleware and dependency bodies not read`.

## Route registries

Prefer runtime discovery: boot the app and read what the framework itself will serve.

| Framework | Registry | Method, path, handler |
|---|---|---|
| FastAPI / Starlette | `fastapi.routing.iter_route_contexts(app.routes)` where it exists: since 0.159, `include_router()` leaves one `_IncludedRouter` in `app.routes`, and this iterator flattens it as the OpenAPI schema does. Else `app.routes`, recursing into `Mount.routes` | `.methods`, `.path`, `.endpoint`. `.dependencies` are the ones declared on the router or decorator; `.dependant.dependencies` are all of them (`Depends`, `Security(…, scopes=…)`). Plus `app.user_middleware` |
| Flask | `app.url_map.iter_rules()` | `rule.methods`, `rule.rule` (`<int:id>` ⇒ `{id}`), `app.view_functions[rule.endpoint]`. Security: decorators (`__wrapped__`), `before_request` per blueprint |
| Express 4 | `app._router.stack` (layers; `layer.route`, or `layer.handle.stack` for a router, prefix from `layer.regexp`) | `route.methods`, `route.path`, the last handler of `route.stack`; earlier handlers and app-level layers are middleware |
| Express 5 | `app.router.stack` (same shape) | as Express 4 |
| Fastify | an `onRoute` hook registered before the plugins, or `printRoutes({ commonPrefix: false })` | `routeOptions.method`, `.url`, `.handler`; `preHandler` / `onRequest` hooks are the checks |
| Laravel | `app('router')->getRoutes()` after the console kernel boots (or `php artisan route:list --json`) | `$route->methods()`, `->uri()`, `->getActionName()`; `->gatherMiddleware()` holds `auth`, `auth:sanctum`, `can:…` |
| Micronaut | the `Router` bean: `router.uriRoutes()` | `UriRouteInfo` method, template, target method; `@Secured` |
| Quarkus / JAX-RS | the deployment's resource model (`ResourceClass`/`ResourceMethod` at test time) | `@Path` class + method, `@GET`…; `@RolesAllowed`, `@Authenticated`, `@PermitAll` |
| Rails | `Rails.application.routes.routes` | `route.verb`, `route.path.spec` (`(.:format)` dropped), `route.defaults[:controller]#[:action]`; `before_action` callbacks |
| ASP.NET Core | `EndpointDataSource.Endpoints` from the built host | `RouteEndpoint.RoutePattern`, `HttpMethodMetadata`; `IAuthorizeData` / `IAllowAnonymous` metadata |
| Go chi / gin / echo | `chi.Walk(router, …)`, `engine.Routes()`, `e.Routes()` | method, path, handler name; middleware only per group: read the group's `Use` |

Use static discovery (reading route declarations from source) only when no registry can be enumerated at runtime: no bootable app object, or routing built from code the boot cannot reach. Write the reason in the discovery file's header comment and in `coverage_note`.

Stop, and commit nothing, when there is no registry and no recognisable routing in the source. Tell the user what you looked for and why it was not enough.

## Classifying an improvised stack

- **The Core Classification does not change.** Every check maps onto `authentication` (anonymous, optional, required, unknown) and `authorization` (none, rule, unknown), at a layer (`global`, `class`, `method`, `framework-default`).
- **A framework check is a Built-in Rule only when its behaviour is fixed by the framework**: Flask-Login's `login_required`, Laravel's `auth` middleware, ASP.NET's `[AllowAnonymous]`. Cite in a comment where that behaviour is documented. Everything the project defines (a dependency `get_current_admin`, a `can:` ability, a custom middleware) is unknown until a Recognition Rule names it, with evidence, as in `SKILL.md` step 5.
- **When the framework has no safe default, the default is `anonymous`/`none` at `framework-default`.** This applies when a route without any check is open, which is the case for every framework in the table above.
- **Read checks from what the framework applies, not from names.** Examples: FastAPI dependencies from `.dependant`, never from the parameter name; Express middleware from the route's stack, never from the file layout.

## Update mode

An improvised Adapted Script has `stack` different from `base_script.stack`.
- When the toolkit now ships a Base Script for its `stack`, offer to re-base. Vendor the new Base Script, move the project sections over, and regenerate. `coverage` then becomes what that Base Script claims, and the summary lists every endpoint whose classification moved.
- Otherwise, replace only the **kept** files with the new Base Script's. In each **extended** file, take the new Base Script's version and carry the stack's edits over, the way project sections are carried: the added builtins, and the identity fields in `build()`. Leave the **rewritten** files as they are. A refresh never resets `stack` to the Base Script's or `coverage` to `complete`: the regenerated inventory still reads `best-effort` with the same `coverage_note`.

## Blind spots

Everything in the closest stack's reference applies, plus:
- **Coverage is only as good as the registry read.** A route added outside it (a sub-app mounted by hand, a raw WSGI or ASGI handler, a catch-all proxy) is missed. Name each one you saw in `coverage_note`.
- **Middleware applied by the platform is invisible**: a reverse proxy, an API gateway, a serverless authorizer. Ask the user, and acknowledge it by `path` when it guards a prefix.
