# Symfony reference

Tested with Symfony 8.1 (SecurityBundle 8.1) and API Platform 5.0 on PHP 8.5. Symfony Security internals read differently in other versions; the script then reports `Symfony Security internals changed` instead of guessing (§ Blind spots).

## Vendor and run

Copy `<skill>/base-scripts/symfony/tools/access-inspector/` into `tools/access-inspector/` with `cp -RL` (`VERSION` is a symlink in the toolkit). Never copy the toolkit's `composer.json`, `composer.lock`, `phpunit.xml`, `tests/` or `vendor/`.

The script runs on the project's own `vendor/autoload.php`: run `composer install` first. It needs `symfony/framework-bundle`. It reads `access_control` only with `symfony/security-bundle` and API Platform operations only with `api-platform/core`, and `.env` files only with `symfony/dotenv`.

`<inspect>` is `php tools/access-inspector/inspect.php`, run from the app root (the directory that holds `composer.json` and `src/Kernel.php`). It boots a subclass of the project's kernel that builds its container into a fresh temporary directory, so `var/cache/` is never touched, and that publishes `security.access_map`, `security.firewall.map` and API Platform's metadata factory to the script. Nothing is dropped into `config/`.

## Where access is decided, by layer

| Layer | Symfony construct | Read by the Base Script |
|---|---|---|
| `global` | the firewall the request falls in (`security: false` ⇒ `security_false`), then the first `access_control` entry matching it | yes |
| `global` | a custom authenticator, an event listener or subscriber on `kernel.request`, a `RequestMatcher` service in `access_control` | no: write a `pathPrefix` rule, or a `construct` rule for the matcher's entry |
| `class` | `#[IsGranted]` (or Sensio `#[Security]`) on the controller class; an API Platform operation inheriting the resource's `security` | yes |
| `method` | `#[IsGranted]` on the action, `$this->denyAccessUnlessGranted(…)` in its body, an API Platform operation's own `security` / `securityPostDenormalize` | yes |
| `framework-default` | no SecurityBundle (`no_security`), no firewall matching (`no_firewall`), no `access_control` entry matching (`no_access_control`) | yes |

The firewall and the entry are decided for one sample request per endpoint, generated as the router would: defaults kept, an optional trailing parameter (`.{_format}`) left out, and every other parameter set to a literal its requirement lists (`{_locale}` with `en|fr` ⇒ `en`), else `1` or `a`. When no such value satisfies a requirement, the endpoint reads `unknown` with `no request path satisfies the route requirements…`. An entry's `path` and `methods` are evaluated; any other condition (`ips`, `host`, `port`, `attributes`, `route`) cannot be decided for every request, so the entry reads `unknown` with `access_control entry N applies only when … match; other requests go on to the next entry`. `raw` reads `<firewall>: <path regex> [<methods>] <conditions> -> <attributes>`, e.g. `main: ^/admin -> ROLE_ADMIN`.

`#[IsGranted]` on the class and on the action both apply, each filtered by its `methods:`. A `denyAccessUnlessGranted()` call is read from the action's own body only.

Handlers are named `src/Controller/AdminController.php:<line>` (the action's first line) for a project class, `Fully\Qualified\Class::method` for a vendor controller. An API Platform route names its resource file at the line of its `new Get(`/`new Post(`… when exactly one line declares that operation class, else the resource's class line.

## Production entry

1. `Boot::KERNEL` is the kernel class production boots (`App\Kernel` unless `public/index.php` says otherwise). The kernel must not be `final`: the script extends it. A `final` kernel is a boot failure; ask the team to drop `final`, never edit it yourself.
2. `Boot::ENV` is the `APP_ENV` production runs with, from the Dockerfile, the deployment manifest or the hosting configuration. Ask when nothing in the repository says it. `APP_DEBUG` is always `0`. The inventory's `boot_environment.entry` is that env.

## Environment

`Boot::environ()` returns the variables production sets that the committed `.env` files lack, each `new Env(NAME, value, reason)`. They are set first; then `.env` and `.env.<ENV>` load without overriding them. `.env.local`, `.env.<ENV>.local` and `.env.local.php` never load: they are a developer's machine, not production.

Look for `%env(…)%` in `config/packages/security.yaml`, `config/routes*`, `config/packages/api_platform.yaml` and any bundle configuring firewalls or routes: each one that shapes access or routes is set to its production value; ask when the source does not say. `Boot` refuses `APP_ENV` and `APP_DEBUG` (set `Boot::ENV`), a name set twice, and an entry without a reason.

The shell's environment is not cleared: a variable exported on a developer's machine still wins over `.env`. Put what shapes access in `environ()` so the inventory does not depend on it.

## Boot failure → stub cookbook

The script prints `cannot boot <kernel> with env <env>: <exception>: <message>`.

| Symptom | Toward-production fix |
|---|---|
| `EnvNotFoundException: Environment variable not found: "APP_SECRET"` (any secret) | `new Env('APP_SECRET', 'inventory-placeholder', 'secret set by the deployment')`, never a real value |
| `EnvNotFoundException` for a value shaping access (`TRUSTED_IPS`, a feature flag) | an `Env` with the production value; ask the user when the repository does not say it |
| `EnvNotFoundException: DATABASE_URL`, a cache or messenger DSN | an `Env` with a placeholder DSN of the production driver (`postgresql://inventory-placeholder/app`). Doctrine connects lazily, so the boot does not reach it |
| A service connecting while the container builds (a compiler pass, a bundle extension calling out) | an `Env` that points it at a placeholder; when no variable controls it, report it |
| `<kernel> is final` | ask the team to remove `final` |
| `class App\Kernel not found`, `ClassNotFoundError` | `composer install` not run, or a dev-only bundle registered for `all` in `config/bundles.php`: report it |

Never set a variable that changes `security.yaml`, routes or API Platform security away from production, and never an `Env` holding a real secret.

## Built-in rules

| Construct | authentication | authorization |
|---|---|---|
| no SecurityBundle, no firewall matching, `security: false`, no `access_control` entry matching, an entry with no `roles` | anonymous | none |
| `PUBLIC_ACCESS` | anonymous | none |
| `IS_AUTHENTICATED`, `IS_AUTHENTICATED_FULLY`, `IS_AUTHENTICATED_REMEMBERED`; expressions `is_authenticated()`, `is_fully_authenticated()`, `is_remember_me()` | required | none |
| any `ROLE_*`; expression `is_granted('ROLE_X')` | required | rule |

An entry or attribute listing several roles is read as the default `affirmative` strategy reads it: any one grants, so the weakest decides. An expression is a Built-in Rule only as one of the calls above with a literal argument: `is_granted('ROLE_ADMIN')` is, `is_granted('ROLE_ADMIN') or object.owner == user` and `is_granted('EDIT', object)` are not. A voter attribute (`#[IsGranted('PROJECT_VIEW')]`, `denyAccessUnlessGranted('EDIT', $post)`) is unknown until a Recognition Rule names it. A `denyAccessUnlessGranted()` call whose attribute is not one literal reads `unknown` with `voter check in handler body`.

## Writing a Recognition Rule

- `construct` is the check exactly as `--unknowns` shows it: after `<firewall>: ` in `raw` for an `access_control` entry (`^/metrics ips=10.0.0.0/8 -> PUBLIC_ACCESS`), the whole `raw` for an attribute, a body call or an API Platform operation (`#[IsGranted('PROJECT_VIEW', subject: 'project')]`, `denyAccessUnlessGranted('EDIT', $post)`, `security: is_granted('BOOK_EDIT', object)`).
- `evidence` is the line of the voter method deciding the attribute (`voteOnAttribute`, or `supports` when it narrows to it), of the expression function, or of the request matcher's `matches`.
- A voter granting reads to everyone: `->safe('anonymous', 'none')`.
- A custom authenticator or `kernel.request` listener enforcing a prefix: `Rule::pathPrefix(name, evidence, '/partner/', 'global', 'required', 'none')->withRaw('<ListenerClass>')`, with evidence on the line that rejects the request.

## Acknowledged Unknowns

- An expression reading the loaded object (`object.owner == user`) or `securityPostDenormalize`: acknowledge its `construct`.
- An `access_control` entry with `ips`, `host` or `port`: acknowledge it with where the network rule lives, or split it with a Recognition Rule when the condition holds for every production request.
- GraphQL (`/api/graphql`), Mercure, WebSocket endpoints: acknowledge the `path`; operations are out of scope.
- An external policy engine called from a voter: acknowledge the construct.

## Blind spots

- Routes are listed once per path and method, the first route winning, as the router matches them. `host`, `condition`, `schemes` and requirements are ignored, so two routes differing only by host show as one.
- The firewall and `access_control` are decided for one sample request; a `path` regex more specific than the route (`^/api/users/1`, `^/en/`) decides other requests differently.
- API Platform's optional `.{_format}` suffix stays in the path.
- `$this->isGranted()`, `AuthorizationCheckerInterface` and `Security::isGranted()` in a handler or a service are not read; nor is a `denyAccessUnlessGranted()` call outside the action's own body. A call inside a branch counts as always applied. Grep handlers flagged `anonymous` or `none` for `isGranted(`, `AccessDeniedException`, `getUser()`.
- The `access_decision_manager` strategy is assumed `affirmative` (the default). With `unanimous` or `consensus`, a multi-role entry may be stricter than the inventory shows.
- `access_control` entries matched by a custom `request_matcher` service always read `unknown`.
- Variables exported in the shell override `.env` (§ Environment).
- The kernel must not be `final`.
- The script reads Symfony Security internals by reflection (`AccessMap`'s entries, `ChainRequestMatcher`'s matchers). When a version moves them, the endpoints show `unknown` with `Symfony Security internals changed: <exception>: …`: report it to the toolkit, never write rules around it. When API Platform's metadata factory is missing, its routes read `unknown` with `API Platform metadata unavailable`.

## Triage checklist

Read each handler in the Triage scope (`SKILL.md` § Triage) for what the inventory cannot see. Raise a Signal on the first item that holds; otherwise mark it `triaged`.

- **Name and verb against the check.** An action named `delete*`, `approve`, `export`, `impersonate` or `refund` with `required/none` or an `anonymous` write is a Signal. So is a `PUT`/`PATCH` operation any signed-in user reaches on a resource whose `POST` needs a role: raise it on the open one.
- **`methods:` filters.** `#[IsGranted(…, methods: ['POST'])]` or an `access_control` entry with `methods` leaves the other verbs to the next check; the inventory shows it. Raise a Signal only when that leaves a write reachable.
- **Checks in the action or its service.** `$this->isGranted()`, `$this->getUser()` compared to the entity, `throw $this->createAccessDeniedException()`, a repository query filtered by owner: follow the call one level into the service and say whether it covers every route of the action.
- **Lookups by id.** A `{id}` route resolved by `#[MapEntity]` or a `find($id)` with no owner or tenant check is a Signal: any signed-in user reads any row. On API Platform, a `Get` without `security` naming `object`, and no Doctrine extension filtering by user, is the same.
- **Bulk and export.** A `StreamedResponse`, a CSV, or a `GetCollection` without `paginationMaximumItemsPerPage` on an `anonymous` or `required/none` endpoint is a Signal.
- **Anonymous writes.** Name what an anonymous write changes. Login, registration, password reset and webhooks verified by signature are expected: mark them `triaged`.
- **Debug and profiler routes.** `_profiler`, `_wdt`, `_error` or an EasyAdmin dashboard in the prod inventory is a Signal.
- **Third-party handler** (`Symfony\…`, `ApiPlatform\…`, a bundle controller): read the configuration that exposes it; otherwise skip it.

Evidence is the line that shows the problem (`src/Service/OrderService.php:41`), not the handler's first line.

## Candidate dimensions

As for any stack: path prefixes that share a firewall or an `access_control` entry (`/admin`, `/api`, `/partner`), roles named in checks (`ROLE_ADMIN` → `staff`), `PUBLIC_ACCESS` entries and `security: false` firewalls → `public`. `rules()` are closures on the endpoint: `new Assign('access_tier', 'staff', fn (Endpoint $e) => str_starts_with($e->path, '/admin'))`.

Each value then gets an expected access in `expected()`, keyed like `DIMENSIONS`. Typical: `public` anonymous or optional, none; `user` required, none or rule; `staff` required, rule.

## Linters

Exclude `tools/access-inspector/` from PHPStan (`excludePaths`), Psalm (`<ignoreFiles>`), PHP-CS-Fixer (`->exclude('tools/access-inspector')` on the finder), PHP_CodeSniffer (`<exclude-pattern>`), Rector (`->withSkip`) and Deptrac. The vendored files follow the toolkit's style, not the project's.
