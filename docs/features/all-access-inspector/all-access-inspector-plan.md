# Implementation Plan: All Access Inspector

PRD: [prd.md](./prd.md). Vocabulary: [CONTEXT.md](../../../CONTEXT.md). Decisions: [docs/adr](../../adr/).

## 1. Feature Description

**Objective**: toolkit = one shared inventory schema + one runtime Base Script per stack (Django, NestJS, Spring, Symfony) + fixtures with golden inventories + a Claude Code skill (the Agent) that vendors a Base Script into a project, pins its boot, resolves unknowns with cited Recognition Rules, and commits on a branch. Afterwards the project regenerates / `--check`s its inventory with no LLM.

**Key Capabilities**:
- **CAN** enumerate every endpoint the framework mounts (runtime), classify authn/authz per HTTP method into a closed vocabulary, keep raw expressions, emit `unknown` honestly.
- **CAN** diff against a Committed Inventory (`--check`, exit 1 + per-endpoint diff), render a table (`--table`).
- **CAN** be fitted by the Agent: stack detect → vendor → boot (toward-production stubs) → unknown loop → Project Dimensions (propose/confirm) → commit on branch + summary. Update mode preserves existing rules.
- **CAN** feed the security-audit skill from the committed JSON, stack-agnostic.
- **CANNOT** evaluate rules into role matrices in the inventory itself (the access map does it downstream, Phase 9), inspect GraphQL/WebSocket operations, merge several apps' inventories, enforce a policy (only diffs), publish Base Scripts as packages.
- **CANNOT** (Agent) edit CI pipelines, stub a settings module, move a routing-shaping setting away from production, claim `complete` on an unsupported stack.

**Business Rules**:
- Endpoint identity = (method, path, handler). Method `ANY` when handler declares no restriction; per-method rules (`IsAuthenticatedOrReadOnly`) expand to explicit methods. Every served method is listed, implicit ones included: `HEAD` wherever `GET` exists, `OPTIONS` from `View.options` / `APIView.options`.
- Several checks on one endpoint all apply (middleware, Recognition Rules, decorators, mixins, DRF, admin). Per axis the strictest wins (authentication `required > unknown > optional > anonymous`, authorization `unknown > rule > none`); the reported layer/raw/rule are those of the first check holding that value, in request order (path rules, global, decorators, view). Inside DRF, the layer that set the permission list is: `get_permissions()` override or `@action(permission_classes=)` (method) > class attribute (class) > `REST_FRAMEWORK` setting (global) > DRF default (framework-default).
- Path: leading `/`, params as `{name}`, trailing slash as declared.
- Handler: project code → `relative/path.py:line` (Django, Symfony); framework code → dotted name, no line. Spring: dotted name for all handlers (no line available at runtime). NestJS: `ControllerClass.method` for all handlers (same reason).
- Core Classification closed: authentication `anonymous|optional|required|unknown`, authorization `none|rule|unknown`, layer `global|class|method|framework-default`. Identity check alone = `required` + `none`. Custom construct without rule = `unknown`.
- Inventory byte-stable: sorted by path, then method, then handler (code point), fixed key order, no timestamps, no absolute paths.
- Fitting complete ⇔ every `unknown` has `unknown_reason`; every Recognition Rule cites existing `file:line`.
- Project Dimension: declared values only; endpoint without value ⇒ script fails naming endpoint.
- Static discovery only when routing not enumerable; reason written in Adapted Script; coverage `best-effort`. Unsupported stack ⇒ improvise from closest Base Script, coverage `best-effort`.
- Update mode: rule whose evidence vanished ⇒ removed + named in summary; moved ⇒ evidence updated.
- security-audit on stale inventory ⇒ warn + proceed.

**Review (Phases 5c–5f, UF12–UF15)** — terms in CONTEXT.md § Review, ADR 0004:
- **CAN** record human Verdicts per endpoint in an append-only Review Log `tools/access-inspector/reviews.jsonl`, committed by the reviewer; replay it against the Committed Inventory into valid / outdated / moot / orphaned; rank the Review Queue in 11 fixed tiers; raise agent Signals through Triage; review in a local app, one by one or in bulk.
- **CANNOT** change the inventory, the Adapted Script or the Base Scripts; let the Agent give a Verdict; let a Verdict cover an endpoint by selector; run git from the CLI or the app; listen beyond localhost.
- Review Key = (method, path, handler with trailing `:<digits>` stripped). Latest `reviewed` event per key wins: `at`, then line order.
- Outdated: endpoint inside its zone's `expected_access` (or no expectation) ⇒ authentication or authorization `value` ≠ seen; outside ⇒ any of `value`, `layer`, `raw`, `rule` ≠ seen on either axis; `accepted` with `until` < today. Moot: seen classification was outside, current is inside ⇒ still valid; outdated wins, so moot is reached only when `expected_access` changed and the values did not (a fixed `finding` goes outdated). Orphaned: key not in inventory.
- Tiers (highest wins, then path, method): 1 open `finding` · 2 outdated · 3 outside expected · 4 any axis `unknown` (Acknowledged or not) · 5 sibling inconsistency · 6 anonymous|optional × unsafe method (`POST PUT PATCH DELETE ANY`) · 7 open agent Signal · 8 required × authz none × path has `{` · 9 anonymous|optional × safe method · 10 other authz none · 11 authz `rule`. Endpoint with a valid `safe`/`accepted` Verdict ⇒ out of queue. Valid `finding` ⇒ in queue, tier 1.
- Sibling inconsistency: two endpoints sharing a project handler (`file:line`; a dotted framework handler such as `RedirectView` serves unrelated paths and groups nothing), or on the same path (trailing `/` ignored), or whose paths differ only by one trailing `{param}/` segment (parent and child; two peer `{param}` paths under one parent are not related), with different authentication or authorization `value`, unless both axes' `rule` are equal. `OPTIONS` rows and `unknown` endpoints are never compared. (Found on moi in 5c: grouping by every handler and comparing `OPTIONS` put 77 rows in tier 5, all noise.)
- HEAD with the same classification as its GET ⇒ one row; a Verdict on GET also appends one on HEAD.
- Agent events (`signal_raised`, `triaged`) carry `seen`; they go outdated by the same rule; a valid human Verdict supersedes them in the queue.
- Bulk review: one event per endpoint selected at save time, shared `batch`; selection containing an open `finding` needs explicit confirmation.

**Access map (Phase 9, UF16–UF18)** — terms in CONTEXT.md § Access map, ADR 0005, ADR 0006:
- **CAN** show, per Role and per Capability, whether the role passes, its Scope and the Basis of each fact; let a human decide a Partial capability in the Review Log; fail CI on an undecided or outdated partial, a stale pin, or a runtime that no longer matches the inventory.
- **CANNOT** change the inventory, the Map Runtime or a Verdict; ship a role, scope or area name; let the Agent decide a cell; write the project's `CONTEXT.md`.
- Read before you write: a fact the code declares in a form a program can read is a Map Rule (`rule`) or read by the base introspect (`extracted`); the vocabulary holds the rest (`curated`), each entry with `reason`; a vocabulary entry a Map Rule already produces ⇒ `map check` exit 1.
- Roles: extracted from the code, each with `at`; kind `signed_in|superuser|group`; `includes` (with `at`) for a role every account of another holds; `staff` (with `at`) when a role passes `staff` checks. Not signed in (`anonymous`) is added by the toolkit, first column. Docs mapping: `CONTEXT.md`, else README/`docs/`; a role in the docs and not in the code (or the reverse) is reported.
- Reach of one endpoint for one role, from `who`: `nobody` ⇒ off; `superuser` kind ⇒ yes; `anyone` ⇒ yes; `anonymous` ⇒ no otherwise; `signed_in` ⇒ yes; `staff` ⇒ yes when the role (or a role it includes) has `staff`, else no; `groups` ⇒ yes when the role or a role it includes is listed; `custom`, or a `who` with basis `open` ⇒ unresolved.
- Cell = over the capability's endpoints: all yes ⇒ `pass`; all off ⇒ `off`; none yes and none unresolved ⇒ `no`; some yes and some no/off ⇒ `partial`; else ⇒ `open`. Basis = weakest of the endpoints' `who` bases and the scope's basis. HEAD rows fold into their GET as in review.
- Scope: shown only on `pass` or `partial`; default "every record", no badge; a program can find the filter but never prove what it means, so a scope is `inferred` when the introspect or a Map Rule read the filter, `curated` when hand-written; never solid.
- Alerts (computed only, in this order): partial with no valid decision; open `finding` decisions; `open` cells; endpoints behind no capability; agent signals on cells; review Signals (all seven named); endpoints outside expected access.
- `map check`: exit 1 on a stale pin, an unused anchor, a duplicate of a Map Rule, a runtime/inventory mismatch, a partial with no valid decision, an outdated decision, a term not in `CONTEXT.md` when it exists (vocabulary areas and the capabilities the vocabulary names), a `group` role absent from the grants or a granted role with no role, a scoped fact naming a capability or role not on the map; exit 2 on an unreadable or schema-invalid vocabulary, runtime or log; exit 0 otherwise. Coverage and open findings printed, never failing.

**Visual Design**: inventory contract + project/toolkit layouts in [prd.md § Visual](./prd.md#visual).

---

## 2. Data Model

No database. The "data model" is the inventory JSON contract, `schema/inventory.schema.json` (JSON Schema draft 2020-12). Every Base Script emits it; fixtures validate against it; the table renderer and `parse_access_inspector.sh` read only it.

### Creation of New Entities

- **Inventory** (root object, keys in this order):
  - `schema_version`: `"1"`
  - `stack`: string (`django|nestjs|spring|symfony`, or detected name when improvised)
  - `discovery_mode`: `runtime|static`
  - `coverage`: `complete|best-effort`
  - `coverage_note`: string|null (required non-null when `best-effort`: static reason or "improvised from <stack> Base Script")
  - `base_script`: `{stack: string, version: string}` (toolkit version vendored)
  - `boot_environment`: `{entry: string, environ: [{name, value, reason}], stubs: [{target, reason}], pinned: [{setting, value, reason}]}` — `entry` = settings module / NestJS root module / Spring application class (the profile pinned as `spring.profiles.active`) / Symfony env
  - `project_dimensions`: object `{<dimension>: [values...]}`, may be `{}`; each value list non-empty, no duplicates
  - `endpoints`: array of **Endpoint**, sorted by (`path`, `method`, `handler`)
- **Endpoint** (keys in this order):
  - `method`: `ANY|DELETE|GET|HEAD|OPTIONS|PATCH|POST|PUT`
  - `path`: string, `^/`, params `{name}`
  - `handler`: string (`path:line` or dotted name)
  - `authentication`: `{value: anonymous|optional|required|unknown, layer: global|class|method|framework-default|null, raw: string|null, rule: string|null}`
  - `authorization`: `{value: none|rule|unknown, layer: same enum|null, raw: string|null, rule: string|null}` — on both axes, `rule` = `builtin:<name>` or `recognition:<name>` that produced the value
  - `dimensions`: object `{<dimension>: value}`; keys must equal `project_dimensions` keys, values ∈ declared list
  - `unknown_reason`: string|null; non-null ⇒ Acknowledged Unknown
- **Serialisation rule** (identical in Python/TypeScript/Java/PHP; reference bytes: `schema/samples/canonical.json`): UTF-8, `\n`, 2-space indent; each root key on its own line with its value compact; `endpoints` one compact object per line at 4-space indent, `"endpoints": []` when empty; compact = separators `", "` and `": "`, non-ASCII unescaped, `/` unescaped; keys in schema order (`project_dimensions` keys and value lists in declared order); endpoints sorted by (`path`, `method`, `handler`) by code point; no trailing whitespace; file ends with `\n`.

- **Review Event** (Phases 5c–5f; one line of `tools/access-inspector/reviews.jsonl`; contract `schema/review-event.schema.json`, draft 2020-12). Keys in this order:
  - `v`: `1`; a higher `v` ⇒ CLI exits 2 "written by a newer toolkit, line N"
  - `at`: UTC `YYYY-MM-DDTHH:MM:SSZ`
  - `by`: `git config user.email` (human) | `agent:<model id>` (`--agent`); human with no git email ⇒ refused
  - `event`: `reviewed|signal_raised|triaged`
  - `batch`: string|null — `b-` + 8 lowercase hex for a bulk or a triage run, null for a single Verdict
  - `endpoint`: `[method, path, handler_key]`, handler_key = handler with trailing `:<digits>` stripped
  - `seen`: `{handler, authentication: {value, layer, raw, rule}, authorization: {value, layer, raw, rule}, inside: bool|null}` — copied from the inventory at append time; `inside` = within `expected_access` for the endpoint's zones, null when no expectation applies
  - then per `event`:
    - `reviewed`: `verdict` `safe|accepted|finding`; `reason` non-empty, ≤ 2000 chars; `severity` `low|medium|high` (required iff `finding`); `ticket` `https?://…` (optional, `finding` only); `until` `YYYY-MM-DD` (optional, `accepted` only)
    - `signal_raised`: `reason` non-empty, ≤ 500 chars; `evidence` `relative/path:line`
    - `triaged`: nothing more
- **Review Log serialisation**: UTF-8, one compact JSON object per line (separators `,` `:`, no spaces), keys in the order above, absent optional keys omitted (never null except `batch`, `inside`), `\n`-terminated; append-only, never reordered or rewritten. Append = open `O_APPEND`, write whole lines, one `write` per call (bulk = one write of N lines).
- **`tools/access-inspector/.gitattributes`**: `reviews.jsonl merge=union`; created by the first `append` if absent (inside `tools/access-inspector/`, so no change outside it).
- **Zone** (derived, not stored): an endpoint is inside when, for every dimension with an `expected_access` entry for its value, both axis values are listed; outside if any dimension says no; no expectation at all, or an axis `unknown`, ⇒ `inside: null` (as the viewer's `zoneCheck`: unknown is never "outside"), treated as inside for outdated rules.
- **App projection** (`node:sqlite`, `~/.cache/all-access-inspector/<sha256(abs project path)[:16]>.sqlite`, never committed, deleted and rebuilt whenever the inventory or log's size or mtime differ from `meta`):
  - `meta(key TEXT PK, value TEXT)` — `inventory_size`, `inventory_mtime`, `log_size`, `log_mtime`, `toolkit_version`, `projection` (the table shape), `today` (an `accepted` Verdict expires on a new day)
  - `endpoint(key TEXT PK, method, path, handler, row JSON, tier INT, signals JSON, state TEXT, verdict JSON NULL, siblings JSON, position INT NULL)` — `key` = JSON of the Review Key; `state` `none|valid|outdated`; `siblings` the keys of its siblings with a different access; `position` its index in the package's `queue(rows)`, null when not queued; one row per inventory endpoint, HEAD folded rows excluded
  - `event(line INT PK, at, by, event, batch, key, payload JSON)`
  - `orphan(key TEXT PK, verdict JSON)`
  - `header(value JSON)` — one row: stack, coverage, endpoint count, whether there are dimensions, valid/outdated/orphaned counts
  - Filled only by replaying through the review package; the app never computes tiers, queue membership or queue order itself.

- **Map Runtime** (Phase 9a; `tools/access-map/runtime.json`, committed, `-diff linguist-generated` in `tools/access-map/.gitattributes`; contract `schema/runtime.schema.json`). Keys in this order: `schema_version` `"1"`, `stack`, `base_script` `{stack, version}`, `about` `{reads, holds[], heuristics[], command}`, `roles[]` `{id, kind, at, basis, includes[{role, at}], staff: {at}|null}`, `grants` `{permission: [{role, at}]}`, `scopes[]` `{id, label, at, basis}`, `scoped[]` `{capability, role, scope, at, basis}`, `capabilities[]` `{id, area, term, verb: read|write, endpoints[[method, path, handler_key]], check, at, basis}`, `endpoints[]` `{method, path, handler, resource?, layers[], permissions[], verdict, fallback, notes[[basis, text]]}` (moi prototype's `codenames` renamed `permissions`, `group` renamed `role`), `snippets` `{file:line: source}`. Serialisation: like the inventory: sorted (`roles` by id, `endpoints` by path, method, handler; object keys in schema order), 2-space indent, `\n`-terminated, no timestamps, no absolute paths, no counts that depend on the run.
- **Map Vocabulary** (`tools/access-map/vocabulary.json`, committed; contract `schema/vocabulary.schema.json`): `areas[]` `{id, name, term, defined_at}`; `roles[]` `{id, name?, doc_at?}` naming extracted roles, or a full hand-written role `{id, kind, at, reason, includes?, staff?}` on a stack with no introspect; `capabilities[]` either `{extends: <extracted id>, name, sub?, area?}` or `{id, name, sub?, area, verb, endpoints, check, evidence[[file:line, text]], reason, replaces?: [ids]}`; `scopes[]`/`scoped[]` as in the runtime plus `reason`; `domains[]`, `resources[]` (unchanged from the prototype); `route_checks` `{path: [{layer, text, at, permissions?, who?}]}` (arrays only, no `_note`); `stack` (read by the introspect only); `anchors` `{file:line: trimmed text}` written by `map pin`. Removed from the prototype: `findings`, `everyone` (now `includes`), `cells` (now computed), the access-state entries of `scopes`.
- **Capability Decision** (Review Event, `v` `2`): `{v, at, by, event: "decided", batch, capability: [capability_id, role_id], seen, verdict, reason, severity?, ticket?, until?}`; `seen` = `{state, reached: [review keys], missed: [review keys], who: {review key: [kind, basis]}}`. Outdated when `state`, `reached` or `missed` differ from the current cell, or `accepted` past `until`; orphaned when the capability or role no longer exists. `signal_raised` and `triaged` may carry `capability` instead of `endpoint` (Agent on the map). Latest per key wins, as for Verdicts.
- **Page data** (derived, never stored): `buildData(project)` ⇒ `{project, inventory, roles, areas, cells[{capability, role, state, scope, basis, decision}], endpoints[{…, who, reach{role: yes|no|off|unresolved}}], alerts[], coverage{covered, total}, method}`; typed once in `map/src/data.ts`, the only input of both UIs.

### Modification of Existing Entities

- Inventory schema: unchanged; the review package reads `schema_version` `"1"` only and exits 2 on any other.
- Viewer: tab label Triage → Overview (Phase 5d); no data change.
- Review Event schema (Phase 9a): `v` `2` adds `decided` and the `capability` key; `v` `1` lines unchanged; a toolkit reading only `v` `1` still exits 2 "written by a newer toolkit". `replay` returns `decisions` beside `rows` and `orphans`.
- security-audit skill: `references/django-access-inspector.md` + `scripts/parse_django_access_inspector.sh` removed, replaced by `references/access-inspector.md` + `scripts/parse_access_inspector.sh` (UF6).

### Relationships

- 1 Inventory ↔ 1 Adapted Script ↔ 1 bootable app. `endpoints[].dimensions` keys ⊆ `project_dimensions` keys (schema-enforced via `additionalProperties`-free check in script, not expressible in JSON Schema alone → runtime check in each Base Script).
- Review Event → Endpoint by Review Key (n:1, 0 when orphaned); Review Events never reference each other; current state = replay.
- `authorization.rule` names a rule in `rules.py` (Django) / `rules.ts` / `Rules.java` / `rules.php`; `unknown_reason` names an Acknowledged Unknown in the same file.

---
## 3. Architecture

Legend: 🟢 new · ⚪ salvaged from a sibling repo (path given) · 🔵 modified existing file. Everything in this repo is 🟢 (repo holds only docs today).

### Toolkit root

#### A. `schema/inventory.schema.json` 🟢
**Purpose**: the single shared contract (§2).
**Changes**: JSON Schema 2020-12; enums for method/values/layers; `required` lists; `additionalProperties: false` everywhere; `if coverage == best-effort then coverage_note: string`; `if discovery_mode == static then coverage == best-effort`; per axis `value == unknown ⇔ rule == null`; `unknown_reason` non-null ⇒ one axis `unknown`. Dimension keys/values are checked by each Base Script (not expressible in JSON Schema).
**Why**: every Base Script, fixture test and the parse script depend on it; written first.

#### B. `Makefile` 🟢, `.github/workflows/ci.yml` 🟢
**Changes**: targets `test-django` (uv + pytest), `test-nestjs` (pnpm + vitest in `base-scripts/nestjs/`, then `inspect.sh` in each NestJS fixture), `test-spring` (`./mvnw` in fixture), `test-symfony` (composer + phpunit), `test` = all four, `lint`. CI: one job per stack, each installs only its toolchain.
**Why**: per-stack toolchain decision.

### Django Base Script — `base-scripts/django/` (vendored as `tools/access-inspector/` in projects)

Stdlib only + the project's Django/DRF. Python ≥ 3.10. Modules live in the package dir `base-scripts/django/access_inspector/` (a private package, so `inspect.py` does not shadow the stdlib `inspect` and no module collides with a project module such as `rules`; `inspect.py` drops its own directory from `sys.path` and registers the package `access_inspector`). Vendoring copies only the script files C–L; `tests/`, `pyproject.toml` and `uv.lock` are toolkit development files and never leave this repo. Each file is a template the Agent edits only where marked `# --- project ---`.

#### C. `inspect.py` 🟢
**Changes**: argparse `--check | --table | --unknowns`; flow `boot.boot()` → `discovery.endpoints()` → `classify.classify(ep)` per endpoint → `dimensions.assign(ep)` → `inventory.validate()` → `inventory.write()` / `inventory.check()` / `table.render()`. `--unknowns` prints JSON lines of endpoints with any `unknown` (handler, raw, method, path) for the Agent loop. Exit codes: 0 ok, 1 check diff, 2 boot/validation error (no file written).
**Why**: UF1/UF2 entrypoint; `--unknowns` is the Agent's interface in UF3/UF5.

#### D. `boot.py` 🟢
**Changes**: `ENTRY = "config.settings.production"` (template default `None` falls back to the `DJANGO_SETTINGS_MODULE` default in `manage.py`, usually a dev module, so the Agent always pins it), `STUBS = [Stub(target="config.secrets.load", replacement=..., reason=...)]`, `PINNED = [Pin("DEBUG", False, reason)]`; `boot()`: insert project root in `sys.path`, set `DJANGO_SETTINGS_MODULE`, apply stubs via `unittest.mock.patch` before `django.setup()`, apply pins via `settings` override (after the settings module ran: import-time logic on `DEBUG` keeps its dev value, so it needs a production `ENTRY`), return `BootEnvironment` for the inventory header.
**Why**: pinned Boot Environment; stub targets are dotted names so a reviewer sees what was replaced.

#### E. `discovery.py` ⚪ from `django-access-inspector/django_access_inspector/services/url_analyzer.py`
**Changes**: keep recursive walk (URLPattern/URLResolver/namespaces/locale resolvers/`_get_callback`); drop debug logger, `CommandError`, URL-name keying; yield `RawEndpoint(callback, pattern_parts: list[str], namespace)`; unknown pattern object → `RawEndpoint` with `unknown_reason="unrecognised urlpattern object <type>"` instead of `TypeError`.
**Why**: completeness rule — never drop, never raise on an exotic pattern.

#### F. `paths.py` 🟢
**Changes**: `normalize(parts) -> str`: join, convert `path()` converters `<int:pk>` → `{pk}`, `re_path` named groups `(?P<pk>...)` → `{pk}`, unnamed groups → `{param}`, strip `^`/`$`, ensure leading `/`, keep trailing slash as declared.
**Why**: path format decision.

#### G. `classify.py` 🟢
**Changes**: resolve the callable: `model_admin` → admin; `.cls` (ViewSet/APIView via `as_view`) → read `actions` map for method→action, per-action `permission_classes` from `@action` kwargs (`authentication_classes` are not read: they say how a user authenticates, not whether authentication is required) or `get_permissions()` when overridden (call with a stub request, catch → unknown); `.view_class` (CBV) → MRO mixins + `http_method_names`; plain function → `__wrapped__` chain for `login_required`/`permission_required`/`user_passes_test` (identity by function object, not name substring); explicit-vs-default detection via `cls.__dict__` vs DRF `api_settings` → layer `class` vs `framework-default`. Methods: DRF `allowed_methods`/actions, CBV `http_method_names` ∩ defined handlers, function view → `ANY` unless `@require_http_methods`. Handler: `inspect.getsourcefile` relative to project root + `getsourcelines` line; outside project root → dotted `module.qualname`. Output `Classified(endpoint, authn, authz)` using `rules.apply`.
**Why**: fixes the four classification defects found in the old tool (name-keyed, class-level-only, `AllowAny` = authenticated, substring greps).

#### H. `rules.py` 🟢
**Changes**: `BUILTIN: dict[object, Outcome]` keyed by DRF/Django classes and decorators (table from UF1 / PRD mapping; `IsAuthenticatedOrReadOnly` = per-method); `RECOGNITION: list[Rule]` template with `Rule(match=<class or callable or path-prefix predicate>, authn=..., authz=..., layer=..., evidence="orders/permissions.py:12", name="IsOrderOwner")`; `ACKNOWLEDGED: list[Ack(handler_or_path, reason)]`; `apply(classified_inputs) -> Outcome` precedence: method > class > global > framework-default; unmatched custom permission ⇒ `unknown`. Built-ins also include `django.contrib.auth.middleware.LoginRequiredMiddleware` (`required` at `global` when in `MIDDLEWARE`, except views marked `@login_not_required`) and `no_check` (`anonymous`/`none` at `framework-default` for a view with no check).
**Why**: built-in vs recognition distinction; evidence lives next to the claim.

#### I. `dimensions.py` 🟢
**Changes**: `DIMENSIONS = {"access_tier": ["public","customer","staff"]}`; `RULES = [(predicate, dimension, value)]` ordered, most specific path first; `assign(ep)` raises `MissingDimension(ep)` when no rule matches.
**Why**: UF4; missing value = failure.

#### J. `inventory.py` 🟢
**Changes**: dataclasses mirroring §2; `to_canonical_json()` implementing the serialisation rule (key order from a constant, sort key `(path, method, handler)`); `validate()` runtime checks JSON Schema cannot (dimension keys, `coverage_note`); `check(committed_path)` → structural diff: added/removed by identity triple, changed by field; renders one line per endpoint.
**Why**: byte stability and `--check` in one place; same logic mirrored in Java/PHP.

#### K. `table.py` 🟢
**Changes**: stdlib fixed-width table: method, path, authn, authz, layer, dimensions, `?` marker on unknown. Never writes files.

#### L. `VERSION` 🟢 — toolkit version copied into `base_script.version`.

### NestJS Base Script — `base-scripts/nestjs/` (vendored as `tools/access-inspector/` next to the app's `package.json`)

TypeScript (ESM), run by the project's own test runner so it inherits the project's transform (decorator metadata) and tsconfig path aliases; no new dependency (`@nestjs/testing` is part of the Nest scaffold). Boots the root module without listening, reads the routes and guards Nest registered. Express adapter (Nest default) fully supported; Fastify: Nest routes only, so `coverage: best-effort` with a `coverage_note`. `package.json`, `tests/` and lockfile are toolkit development files and never leave this repo. Project sections marked `// --- project ---` in `boot.ts`, `rules.ts`, `dimensions.ts`.

#### AK. `inspect.sh` 🟢
**Changes**: args `--check | --table | --unknowns`; picks the project's runner from `package.json` devDependencies (`vitest` ⇒ `vitest run --config tools/access-inspector/vitest.config.ts`, `jest` ⇒ `jest --config tools/access-inspector/jest.config.cjs`, neither ⇒ exit 2 naming both) and the package manager from the lockfile (`pnpm exec` / `yarn` / `npx`); passes the mode and a temp dir in `ACCESS_INSPECTOR_MODE` / `ACCESS_INSPECTOR_OUT`; prints the harness's `stdout` file and exits with its `status` file (missing ⇒ 2: the boot crashed before writing it). Keeps the runner's own reporter output off stdout.
**Why**: a test runner always exits 1 on failure; the status file restores the 0/1/2 contract.

#### AL. `vitest.config.ts`, `jest.config.cjs` 🟢
**Changes**: extend the project's own runner config (`mergeConfig` / spread of the project's jest config: transform, `moduleNameMapper`) and override only `include`/`testRegex` = `tools/access-inspector/run.spec.ts`, no `setupFiles` (the project's integration setup may need a database), no coverage, one worker.

#### AM. `run.spec.ts` 🟢 — single test; flow `boot()` → `discover()` → `classify()` per endpoint → `assign()` dimensions → `validate()` → write / `check()` / table / unknowns; writes `status` and `stdout` to `ACCESS_INSPECTOR_OUT`; any throw ⇒ status 2 with the error.

#### AN. `boot.ts` 🟢
**Changes**: project section: `ENTRY` (`{module: '../../src/app.module.js', export: 'AppModule'}`), `CONFIGURE` (optional `{module, export}` of the project's HTTP setup function, e.g. `configureApp`, applied to the app as `main.ts` does: global prefix, versioning, `useGlobalGuards`), `ENVIRON: Env[]` (applied to `process.env` before the entry is imported, overriding the shell and any `.env` the config module reads), `STUBS: Stub[]` (`{token, reason, value}` → `overrideProvider(token).useValue(value)`). Boot = `Test.createTestingModule({imports: [Entry]})` + overrides → `createNestApplication({logger: false})` → `CONFIGURE(app)` → `app.init()`, never `listen`. Guards: `NODE_ENV` must be `production` (set it in `ENVIRON`, else `BootError("NODE_ENV must be production")`); a stub may not target a guard, a controller or the entry module (`BootError("access-shaping provider may not be stubbed")`); every `Env`/`Stub` needs a reason; `Env` names validated as in Django. Recorded in `boot_environment` (`pinned` always `[]`).

#### AO. `discovery.ts` 🟢
**Changes**: `DiscoveryService.getControllers()` × `MetadataScanner.getAllMethodNames(prototype)`; route from `PATH_METADATA`/`METHOD_METADATA` (`@nestjs/common/constants`); full path built with Nest's own `RoutePathFactory` + `ApplicationConfig` (global prefix and its `exclude`, versioning) + `RouterModule` module paths, so paths are Nest's; `RequestMethod.ALL` ⇒ `ANY`; `HEAD` added beside each `GET` (Express serves it through the GET handler, guards included); `:id` ⇒ `{id}`, wildcard ⇒ `{name}`. Express only: after `init()`, walk the adapter's router stack; a route no Nest endpoint accounts for ⇒ endpoint `unknown` on both axes, handler = the layer's name, reason "mounted on Express outside Nest". Handler = `ControllerClass.method`.

#### AP. `classify.ts` 🟢
**Changes**: guards in request order: global (`ApplicationConfig.getGlobalGuards()` + `APP_GUARD` request guards) ⇒ `global`, controller `GUARDS_METADATA` ⇒ `class`, handler `GUARDS_METADATA` ⇒ `method`; each guard ⇒ finding `{construct: guard class name, layer, raw, metadata}` where `metadata` = every custom metadata key on handler and class, merged with `Reflector.getAllAndOverride` semantics (handler wins). No guard at all ⇒ `builtin:no_check` `anonymous`/`none` at `framework-default`.

#### AQ. `rules.ts` 🟢
**Changes**: builtins: `@nestjs/passport` `AuthGuard(type)` (memoized mixin, detected by identity against `AuthGuard(type)` itself) ⇒ `required`/`none`, raw `AuthGuard('jwt')`; a project subclass of it is a project guard and needs a rule; `NEUTRAL` = guards that are not access control (`ThrottlerGuard` built in; project section adds more, each with evidence) ⇒ no finding. Project section `RECOGNITION: Rule[]`, `ACKNOWLEDGED: Ack[]`, same fields as Django (`construct` | `path_prefix`+`layer`, `authn`, `authz`, `safe_authn`/`safe_authz`, `evidence`) plus `when_metadata` (`{isPublic: true}`: matches only when every listed key equals the endpoint's metadata) and `raw_metadata` (`'roles'`: appended to raw); for one construct the first matching rule in declaration order wins, so the conditional rule precedes the default one. Strictest-wins precedence and per-method expansion identical to Django.

#### AR. `dimensions.ts`, `inventory.ts`, `paths.ts`, `table.ts` 🟢 — mirror H/I/J/K; `inventory.ts` hand-rolled per-line `JSON.stringify` to honour the serialisation rule byte for byte.

### Spring Base Script — `base-scripts/spring/`

#### M. `tools/access-inspector/inspect.sh` 🟢
**Changes**: detect `mvnw`/`gradlew`; run `AccessInspectorRun` with `-Daccess.inspector.mode=write|check|table|unknowns` and `-Daccess.inspector.out=tools/access-inspector/inventory.json`; map test failure → exit 1 (check) / 2 (boot). Gradle: `./gradlew test --tests accessinspector.AccessInspectorRun -Daccess...` via `systemProperty` passthrough documented in `references/spring.md`.

#### N. `src/test/java/accessinspector/AccessInspectorRun.java` 🟢
**Changes**: `@SpringBootTest(webEnvironment=MOCK) @ActiveProfiles(Boot.PROFILE)`; single `@Test run()` reading the mode property; wires `Discovery`, `FilterChainResolver`, `MethodSecurity`, `Rules`, `Dimensions`, `Inventory`, `Table`.

#### O. `Boot.java` 🟢 — `PROFILE`, `@MockBean`/`@TestConfiguration` stubs list with reasons, pinned properties via `@TestPropertySource`.

#### P. `Discovery.java` 🟢
**Changes**: iterate `RequestMappingHandlerMapping.getHandlerMethods()` (all mappings incl. actuator via `WebMvcEndpointHandlerMapping` beans: iterate every `HandlerMapping` bean that exposes handler methods); expand `RequestMappingInfo` patterns × methods (empty methods ⇒ `ANY`); handler = dotted name `com.acme.CarsController.list` for every Spring handler (project and framework alike), no line: `HandlerMethod` carries no line and a source scan was rejected. `/error` from `BasicErrorController` included.

#### Q. `FilterChainResolver.java` 🟢
**Changes**: for each endpoint build a `MockHttpServletRequest(method, path)`; pick first `SecurityFilterChain` whose `matches(request)`; inside, locate `AuthorizationFilter` → `RequestMatcherDelegatingAuthorizationManager` → iterate its mappings (reflection on `mappings` field) → first matcher that matches → classify manager: `AuthenticatedAuthorizationManager` ⇒ `required`; permitAll (`SingleResultAuthorizationManager` granted / `(a,o)->true`) ⇒ `anonymous`; `AuthorityAuthorizationManager` ⇒ `required` + `rule` raw authorities; `WebExpressionAuthorizationManager` ⇒ `required`? no ⇒ `unknown` with raw expression unless expression ∈ builtin set; custom ⇒ `unknown`. No chain matches ⇒ `anonymous` at `framework-default`. Raw = matcher `toString()` + chain bean name.
**Why**: the global layer the old tool could not see; uses Spring's own matching so semantics are Spring's.

#### R. `MethodSecurity.java` 🟢
**Changes**: `AnnotatedElementUtils.findAllMergedAnnotations` for `PreAuthorize`, `PostAuthorize`, `Secured`, `RolesAllowed` on method then class (meta-annotations included); all recorded; builtin SpEL set (`isAuthenticated()`, `permitAll()`, `denyAll()`, `hasRole(...)`, `hasAnyRole(...)`, `hasAuthority(...)`) → classification; anything with `@bean` or custom method ⇒ `unknown`.

#### S. `Rules.java`, `Dimensions.java`, `Inventory.java`, `Table.java` 🟢 — mirror H/I/J/K. `Inventory` uses Jackson with a custom writer to honour the serialisation rule byte for byte.

### Symfony Base Script — `base-scripts/symfony/`

#### T. `tools/access-inspector/inspect.php` 🟢 — argv `--check|--table|--unknowns`; `require vendor/autoload.php`; `src/Boot.php`; same flow.

#### U. `src/Boot.php` 🟢 — `KERNEL='App\Kernel'`, `ENV='prod'`, `APP_DEBUG=0`; `environ()` lists `Env` (name, production value, reason) set in `$_SERVER`/`$_ENV` before `.env` and `.env.<ENV>` load (never `*.local`); boots `InspectorKernel`, returns the container. No stubs, no pins: `boot_environment.stubs` and `pinned` are `[]`.

#### V. `src/Kernel.php` 🟢 (`InspectorKernel extends` the project's kernel; nothing dropped into `config/`)
**Changes**: cache, build and log dirs in a fresh temp dir; a `TYPE_BEFORE_REMOVING` compiler pass aliases `access_inspector.access_map` → `security.access_map`, `access_inspector.firewall_map` → `security.firewall.map`, `access_inspector.resource_metadata` → API Platform's metadata factory, all public, and records whether SecurityBundle is registered and each controller service's class.
**Why**: only way to reach resolved `access_control` without a test container, without touching the project's config or cache; the kernel must not be `final`.

#### W. `src/Discovery.php` ⚪ from `accent/src/AccessControl/AccentReportFactory.php`
**Changes**: `$container->get('router')->getRouteCollection()`; per route × `getMethods()` (empty ⇒ `ANY`); path from `getPath()` (already `{name}`); handler: resolve `_controller` (`Class::method` or invokable) → `ReflectionMethod` file relative + `getStartLine()`; API Platform routes → declaring resource class file + attribute line when resolvable, else dotted.

#### X. `src/AccessControlResolver.php` 🟢
**Changes**: `Request::create(path, method)`; `access_map->getPatterns($request)` → `[attributes, channel]`; `firewall_map` → firewall config (`security: false` ⇒ `anonymous` at `global`); attributes: `PUBLIC_ACCESS` ⇒ `anonymous`; `IS_AUTHENTICATED_*` ⇒ `required`; `ROLE_*` ⇒ `required` + `rule`; expression ⇒ `unknown` unless builtin. Raw = matched rule as string.

#### Y. `src/Attributes.php` 🟢 — reflection for `#[IsGranted]`, `#[Security]` on class/method; builtin set (`ROLE_*`, `IS_AUTHENTICATED_*`) else `unknown` with raw expression.

#### Z. `src/ApiPlatform.php` ⚪ from `accent/src/AccessControl/RouteAccessControlFactory.php`
**Changes**: keep metadata lookup; operation `getSecurity()` already merged with resource-level by API Platform; `null` ⇒ no method-layer entry (global layer still applies); `is_granted('ROLE_X')` builtin, else `unknown`. Metadata factory absent ⇒ `unknown` + reason, never crash.

#### AA. `src/Rules.php`, `Dimensions.php`, `Inventory.php`, `Table.php` 🟢 — mirror H/I/J/K; `Inventory` hand-rolled `json_encode` per line with `JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE`.

### Fixtures — `fixtures/`

#### AB. `fixtures/django-demo/` ⚪ seed `django-access-inspector/demo_views/` + `django_access_inspector/settings.py`
**Changes**: add unnamed view, duplicate-name views, `IsAuthenticatedOrReadOnly` viewset, admin registered model, `i18n_patterns` block, `@require_http_methods`, `get_permissions()` override, `TenantMiddleware` (for a recognition-rule test), a `/graphql/` stub view, custom `IsOwner` left unknown. `expected/inventory.json` golden. `tools/access-inspector/` = Base Script as vendored with one Recognition Rule + one Acknowledged Unknown + one dimension, to test the templates end to end.

#### AC. `fixtures/spring-demo/` ⚪ seed `spring-access-inspector/sample/microservice-example`
**Changes**: add `SecurityConfig` with ordered matchers + a second chain with `securityMatcher`, actuator starter, interface-declared mapping, `@RolesAllowed({"USER","ADMIN"})`, custom `@permissionEvaluator` call. Golden + vendored script.

#### AD. `fixtures/spring-gradle-smoke/` 🟢 — minimal Gradle app, 2 endpoints, proves `inspect.sh` Gradle path.

#### AS. `fixtures/nestjs-demo/` 🟢 — latest NestJS + Express, vitest, written from scratch: `APP_GUARD` token guard with `@Public()` metadata, `@UseGuards` on a controller and on a handler, `@nestjs/passport` `AuthGuard('jwt')`, `@Roles` (`SetMetadata` + `RolesGuard`), `ThrottlerGuard`, an unguarded controller, `@All()`, `CONFIGURE` setting a global prefix with an exclusion and URI versioning, a `RouterModule` path, an Express router mounted outside Nest, a middleware guarding `/api/partner` (recognition rule), a guard reading the body (Acknowledged Unknown), dimension `access_tier`. Golden + vendored script.

#### AT. `fixtures/nestjs-jest-smoke/` 🟢 — minimal Nest app on jest, 2 endpoints, proves the jest path of `inspect.sh`.

#### AE. `fixtures/symfony-demo/` 🟢 — latest Symfony skeleton (8.1) + security bundle + latest API Platform (5.0) + API Platform resource (resource-level security, one operation override), controllers with/without attributes, `access_control` rules, `denyAccessUnlessGranted` call, a firewall with `security: false`. Golden + vendored script.

### Agent skill

#### AF. `SKILL.md` 🟢
**Changes**: workflow: (1) detect stack (`manage.py`/`pyproject` django dep; `package.json` with `@nestjs/core`; `pom.xml`/`build.gradle` + spring-boot; `composer.json` symfony/framework-bundle) → else closest-stack rule (`references/unsupported.md`); (2) existing `tools/access-inspector/` ⇒ update mode; (3) copy `base-scripts/<stack>/`; (4) boot: find production entry, run, on failure read traceback, stub per toward-production rule, record in `boot.*`; (5) loop: `--unknowns` → for each, read handler/construct source → Recognition Rule with evidence or Acknowledged Unknown; ask user only when source does not settle it; rerun until `--unknowns` empty; (6) dimensions: propose from prefixes/middleware/roles → AskUserQuestion confirm/rename/reject → write; (7) `inspect --table` for the user, write inventory, pick `assets/ci-snippets/<ci>.yml`; (8) `git checkout -b access-inspector/fit`, commit, print summary from `assets/summary-template.md`. Hard rules list (never edit pipeline, never stub settings module, never claim complete when improvised, never remove core fields).

#### AG. `references/django.md`, `references/nestjs.md`, `references/spring.md`, `references/symfony.md`, `references/unsupported.md` 🟢
**Changes**: per stack: where authn/authz lives by layer, how to find the production entry, common boot failures and their toward-production stubs, built-in rule table, known blind spots. `unsupported.md`: closest-stack table (FastAPI/Flask→django; Express/Fastify without Nest→nestjs; Micronaut/Quarkus→spring; Laravel→symfony), route-registry hints per framework.

#### AH. `assets/ci-snippets/{github-actions,gitlab-ci,generic}.yml` 🟢, `assets/summary-template.md` 🟢.

### security-audit skill (sibling repo `../skills/security-audit`)

#### AI. `references/access-inspector.md` 🟢, `scripts/parse_access_inspector.sh` 🟢
**Changes**: reference: locate `**/tools/access-inspector/inventory.json`, never boot, run `--check` only to detect staleness (warn), one section per inventory. Parse script (jq): `=== ACCESS INSPECTOR SUMMARY ===` (mode, coverage, counts by authn/authz/layer/dimension), `=== ANONYMOUS ===`, `=== OPTIONAL WITHOUT RULE ===`, `=== UNKNOWN (unexplained) ===`, `=== ACKNOWLEDGED UNKNOWN ===` JSON lines.

#### AJ. `references/django-access-inspector.md` 🔵 removed, `scripts/parse_django_access_inspector.sh` 🔵 removed, `references/scan.md` 🔵 lists `access-inspector.md`, `SKILL.md` 🔵 step 4 parse list updated.

### Review package — `review/` (Phases 5c–5f; ships with the skill, never vendored into projects)

TypeScript run directly by Node ≥ 24 (type stripping): erasable syntax only (no `enum`, no parameter properties, no namespaces), relative imports with `.ts` extension, no runtime dependency, no build. Pure functional core (`inventory.ts`, `replay.ts`, `signals.ts`, `tiers.ts`) + I/O shell (`log.ts`, `cli.ts`). Reads git only through `git config user.email` and `git status --porcelain -- <log>`; never writes through git.

#### BA. `review/package.json`, `tsconfig.json`, `vitest.config.ts` 🟢
**Changes**: ⚪ mirror `base-scripts/nestjs/` tooling: private, `"type": "module"`, devDependencies only (`typescript`, `vitest`, `@types/node`, `ajv` for the schema test); `engines.node >=24`; tsconfig as nestjs minus decorators, plus `allowImportingTsExtensions`, `erasableSyntaxOnly`.
**Why**: same toolchain as the NestJS Base Script; zero install to run the CLI from an installed skill.

#### BB. `schema/review-event.schema.json` 🟢
**Changes**: §2 Review Event as JSON Schema 2020-12; `oneOf` per `event`; `severity` required iff `verdict == finding`; `ticket` only on `finding`, `until` only on `accepted`.
**Why**: contract beside `inventory.schema.json`; the CLI validates by hand, a test keeps both in agreement.

#### BC. `review/src/inventory.ts` 🟢
**Changes**: `loadInventory(path)` ⇒ throws on missing file or `schema_version != "1"`; `reviewKey(e)` (strip `/:\d+$/` from handler); `foldHead(endpoints)` (⚪ viewer `fold`: HEAD folded into the GET with the same path, handler, both axes, dimensions, `unknown_reason`, `acknowledged`; kept as `head` on the GET row); `inside(e, expected_access)` ⇒ `true|false|null` per §2 Zone; `seenOf(e)`.

#### BD. `review/src/log.ts` 🟢
**Changes**: `readLog(project)` ⇒ events + `{line, message}` errors (bad JSON, schema, unknown `v`); missing file ⇒ empty; `serialize(event)` (§2 key order, compact); `append(project, events)` ⇒ validates all, then one `O_APPEND` write, creates `tools/access-inspector/.gitattributes` when absent; `newBatch()` ⇒ `b-` + 8 hex (`crypto.randomBytes`).

#### BE. `review/src/replay.ts` 🟢
**Changes**: pure `replay(inventory, events, today)` ⇒ `{rows: Row[], orphans: Orphan[]}`. Per key: latest `reviewed` (by `at`, then line) ⇒ `state` `valid|outdated` per §1 rules, `moot` flag; agent events: latest per key, dropped when outdated or when a valid Verdict exists. `Row` = folded endpoint + `key`, `inside`, `verdict`, `state`, `moot`, `agent` (`signal_raised`|`triaged`|null), `signals`, `tier`.

#### BF. `review/src/signals.ts`, `review/src/tiers.ts` 🟢
**Changes**: `signals(row, siblings)` ⇒ ordered list of `{id, text}`: `outside_expected`, `unknown`, `sibling` (names the sibling), `open_write`, `agent`, `id_without_authz`, `open_read`; `siblingIndex(rows)` per §1 (by handler key, and by path with last `{param}/` segment removed). `tierOf(row)` ⇒ 1–11 per §1; `queue(rows)` ⇒ rows without valid `safe`/`accepted`, sorted tier, path, method (code point).
**Why**: single implementation for CLI, app, skill.

#### BG. `review/src/cli.ts` 🟢 — `node <skill>/review/src/cli.ts <command> <project dir>` (project dir = the app root holding `tools/access-inspector/`)
**Changes**:
- `status [--json]`: header (stack, coverage, endpoints, valid/outdated/orphaned counts), queue grouped by tier with signals, then orphans; `--json` = one JSON `Row` per line (used by Triage). Exit 0; 2 on missing inventory ("fit the project first"), bad inventory, or bad log line ("reviews.jsonl line N: …").
- `append --verdict safe|accepted|finding --reason <text> [--severity] [--ticket] [--until] [--handler <key>] <METHOD> <path>`: resolve endpoint (method+path; `--handler` required when ambiguous); folded HEAD appended too; `by` = git email (none ⇒ exit 2). Refusals exit 2, nothing written.
- `append --agent --model <id>`: stdin JSON lines `{method, path, handler?, event: signal_raised|triaged, reason?, evidence?}`; one batch; `--verdict` with `--agent` ⇒ exit 2.
- `app`: starts `apps/review` when the CLI runs from a toolkit checkout (`../../../../apps/review` relative to `cli.ts` exists), else exit 2 "the review app runs from a checkout of all-access-inspector".

### Review app — `apps/review/` (Phases 5e–5f; repo root, not shipped with the skill)

Next.js App Router, server components + server actions, no client data fetching library, no auth. Started by `review app <project>` ⇒ `next start -H 127.0.0.1 -p 4377` (first free port from 4377) with `REVIEW_PROJECT=<abs path>`; built on first run. Imports the review package by relative path (`turbopack.root` = repo root). Styling: plain CSS with the viewer's tokens (system fonts, light/dark) ⚪ `viewer/inventory-viewer.html`.

#### BH. `apps/review/lib/projection.ts` 🟢
**Changes**: `node:sqlite` per §2; `load()` on every request: compare `meta` with `stat` of inventory and log ⇒ rebuild (delete file, `replay`, insert) or reuse; `queue(filters)`, `row(key)`, `history()`, `orphans()` query it. `uncommitted()` ⇒ new lines from `git diff --numstat` + untracked.
**Why**: per-request staleness check gives "reflects external changes" without a file watcher.

#### BI. `apps/review/app/page.tsx` (Queue) 🟢
**Changes**: header (project, stack, coverage, counts, "N events not committed"); filters as search params (`zone`, `tier`, `signal`, `state`, `q`, `view=reviewed`); rows grouped by tier; zone column/filter hidden without dimensions; row click ⇒ `?e=<key>` opens the panel.

#### BJ. `apps/review/app/endpoint-panel.tsx` 🟢
**Changes**: per axis value/layer/raw/rule/evidence; siblings with a different access (those behind the `sibling` Signal: one with the same access says nothing to review); signals with reasons; event history of the key; links `vscode://file/<abs>/<file>:<line>` for handler and evidence; outdated ⇒ seen vs current side by side, previous reason prefilled; orphan candidates (same path or same handler file) with "copy reason" (Phase 5f).

#### BK. `apps/review/app/actions.ts` 🟢
**Changes**: `saveVerdict(key, form)` and `saveBulk(filters, form, confirmFinding)` ⇒ validate (missing reason / severity ⇒ field errors, nothing written), recompute selection server-side from the same filters, refuse when it contains an open `finding` and `confirmFinding` is false, `append()` from BD, `revalidatePath('/')`. Next unreviewed row of the same tier selected after a single save.

#### BL. `apps/review/app/history/page.tsx` 🟢 (Phase 5f)
**Changes**: events grouped by `batch` (null batch = own group), newest first: by, at, event/verdict, reason, count, expandable endpoints; agent batches labelled with the model; orphans list.

#### BM. `apps/review/package.json`, `next.config.ts`, `tsconfig.json` 🟢 — `next`, `react`, `react-dom`; devDependencies `typescript`, `vitest`, `@playwright/test`.

### Skill and viewer (Phase 5d)

#### BN. `SKILL.md` 🔵
**Changes**: description adds triage; new `## Triage` section: precondition Committed Inventory (else "fit first"); run `status --json`; scope = rows with `triage` true in `status --json`: no valid Verdict, tier ≠ 11, no agent event that still holds (or as the user names: endpoints, prefix); read each handler per the stack reference's checklist; one `append --agent --model <own id>` call with all lines; never a Verdict, never edit outside `reviews.jsonl`, never commit; summary: read / raised (reasons) / skipped (why). Hard rules: Triage writes only through the CLI. Update mode and a Base Script refresh never touch `reviews.jsonl` or `.gitattributes` (not vendored files; a refresh leaves them, and the regenerated inventory makes Verdicts outdated through replay).

#### BO. `references/django.md`, `references/nestjs.md` 🔵 — `## Triage checklist`: handler name/verb vs guard; body checks the inventory cannot see (Django: `request.user`, `PermissionDenied`, `get_queryset` filter, `get_object`; NestJS: `@Req() user` use, service-level checks); bulk or export responses; anonymous writes; third-party handler ⇒ read the mounting line or skip.

#### BP. `viewer/inventory-viewer.html` 🔵 — tab label Triage → Overview (text and ids only).

#### BQ. `Makefile` 🔵, `.github/workflows/ci.yml` 🔵
**Changes**: `install-review` (pnpm in `review/` and `apps/review/`), `test-review` (vitest in both, then Playwright e2e), `typecheck-review`; `test`, `check-all` include them; CI job `review` on Node 24 + pnpm, mirror of the `nestjs` job.


### Access map (Phase 9; ⚪ = from the moi prototype, `chore/access-inspector-refit` 79b814b6, `.claude/skills/all-access-inspector/`, never committed)

#### CA. `schema/runtime.schema.json` 🟢 ⚪ — rewritten to §2 Map Runtime (roles, includes, staff, scopes, scoped, capabilities; `permissions`, `role`).

#### CB. `schema/vocabulary.schema.json` 🟢 — §2 Map Vocabulary; `reason` required on every hand-written role, grant, scope and capability.

#### CC. `schema/review-event.schema.json` 🔵 — `v` 2, `decided`, `capability` key on `decided`/`signal_raised`/`triaged`.

#### CD. `review/src/log.ts`, `replay.ts`, `append.ts`, `cli.ts` 🔵
**Changes**: validate and serialise `v` 2 lines (hand-written validation, like `v` 1; ajv only in tests); `replay` ⇒ `{rows, orphans, decisions}` with decisions `valid|outdated|orphaned` against a cell fingerprint passed in by the map (the review package knows nothing of cells); `appendDecision()` shares the `O_APPEND` path; `output` exported from `cli.ts` (prototype one-liner).

### Django Map Introspect — `base-scripts/django/access_map/` (vendored as `tools/access-map/`)

Split of the prototype's 523-line `introspect.py` so no file passes the Base Script's largest (332 lines), project section in its own file like `boot.py`/`dimensions.py`/`rules.py`.

#### CE. `introspect.py` 🟢 ⚪ — entry: boot through the Adapted Script's `boot.py`, run the Map Rules and `admin.py`, write `runtime.json`; `--check` regenerates in memory and diffs against the committed file (exit 0 / 1 with a per-key diff / 2 on boot failure or missing inventory).

#### CF. `project.py` 🟢 ⚪ — the project section only: `FIRST_PARTY`, `CONSTANT_FILES`, `SUPERUSER_RULES`, `SIGNED_IN_RULES`, `STAFF_RULES`, and the Map Rules `roles()`, `includes()`, `staff()`, `grants()`, `scopes()`, `capabilities()`, each returning facts with `at`. Shipped empty with commented examples (Django `Group` grants dict, a sign-in adapter adding a group, a `get_queryset` filter on the user's subsidiary); no moi value.

#### CG. `admin.py` 🟢 ⚪ — what the admin registry enforces: per admin URL the `has_*_permission` Django calls, first-party overrides with source and `file:line`, the page view, `formfield_for_manytomany`, `save_related`; `get_queryset` overrides as scope candidates (`inferred`); each registered `ModelAdmin` ⇒ an area (model name as term) and its actions ⇒ extracted capabilities; `vocabulary.stack.admin_actions` for custom URLs.

#### CH. `runtime.py` 🟢 — §2 serialisation and the `--check` diff, mirroring `access_inspector/inventory.py`.

### Map package — `map/` (ships with the skill; `node <skill>/map/src/cli.ts`, no install)

#### CI. `map/src/runtime.ts` ⚪ — load and validate `tools/access-map/runtime.json` (path moved out of `out/`); empty runtime with a note when the stack has no introspect.

#### CJ. `map/src/vocabulary.ts` ⚪ — load and validate; `pin`, `staleReferences` (prototype); terms checked against `CONTEXT.md` when it exists; duplicates of Map Rules.

#### CK. `map/src/roles.ts` 🟢 — role list: `anonymous`, then runtime roles merged with vocabulary names and docs, `superuser` last; `includes` closure; `reach(who, role)` per §1.

#### CL. `map/src/cells.ts` 🟢 — capability list (extracted, `extends`, hand-written, `replaces`); cell state, scope and basis per §1; fingerprint for decisions; decisions joined from `replay`.

#### CM. `map/src/join.ts` ⚪ — per-endpoint layers and `who` (prototype order), wording stack-neutral ("holds <permission>", Django phrasing only from `runtime.about`), all dimensions passed through (no `access_tier` / `module` by name).

#### CN. `map/src/alerts.ts` 🟢 — §1 Alerts, every review Signal labelled.

#### CO. `map/src/data.ts` 🟢 — `buildData(project)` ⇒ §2 Page data, and its type; the only input of `page.html` and the app pages.

#### CP. `map/src/cli.ts` ⚪ — `build [--out]`, `check`, `pin`, `decide <capability> <role> --verdict … --reason …`; exit codes per §1.

#### CQ. `map/page.html` ⚪ — draws Page data only: title and heading from the project, no default selection, no `localStorage` marks, no `reaches()`/`cell()`; basis borders (solid, ≈, dotted ✎, dashed) with the basis in each `aria-label`; one legend for all tabs; decisions read-only.

#### CR. `map/package.json`, `tsconfig.json`, `vitest.config.ts`, `pnpm-workspace.yaml` ⚪ — mirror `review/`.

### Review app — map pages (Phase 9b)

#### CS. `apps/review/app/map/page.tsx`, `cell-panel.tsx`, `routes.tsx` 🟢 — tabs as `?tab=alerts|roles|routes|method`, filters as URL params; cell panel with reached/missed endpoints, decision history and `VerdictForm`; an endpoint opens the existing endpoint panel; map entry disabled when `tools/access-map/` is absent.

#### CT. `apps/review/app/actions.ts` 🔵 — `saveDecision(capability, role, form)` through CD's `appendDecision`; next undecided partial selected after a save.

#### CU. `apps/review/lib/projection.ts` 🔵 — `buildData` result cached per request on the sizes and mtimes of inventory, runtime, vocabulary and log; refreshed when one changes.

#### CV. `apps/review/app/history/page.tsx` 🔵 — decisions beside Verdicts in their batch; orphaned decisions.

### Skill (Phase 9c)

#### CW. `SKILL.md` 🔵 ⚪ — description adds the map; `## Map` rewritten: hard rule "read before you write"; steps: vendor the introspect and write Map Rules (shown with evidence before saving), extract roles and map them to the docs, write the vocabulary for the rest with reasons, `pin`/`check`/`build`, summary with coverage, partials and "could be extracted".

#### CX. `references/{django,nestjs,spring,symfony}.md` 🔵 ⚪ — `## Map introspect`: Django vendoring and a Map Rule cookbook; the others: where roles, grants and scopes live on that stack, and no introspect yet. Django `## Linters` adds `tools/access-map/`.

#### CY. `assets/summary-template.md` 🔵 ⚪ — map next step, coverage, "could be extracted".

#### CZ. `Makefile` 🔵, `.github/workflows/ci.yml` 🔵 — `install-review` and `test-review`/`typecheck-review` cover `map/`; Django `lint`/`typecheck`/`test-django` cover `access_map/` and the map golden.

#### DA. `fixtures/django-demo/` 🔵 — a grants dict for two groups, a sign-in path adding every account to one of them, a `get_queryset` filtered by owner, a custom admin URL checking a different permission than its list (the partial), a `CONTEXT.md`; `expected/runtime.json`, `tools/access-map/vocabulary.json`, `tests/test_map_golden.py`.

#### DB. `README.md` 🔵, `VERSION` 🔵 — Access map section; 0.4.0.

---
## 4. Test Plan

Principle (PRD): golden-file tests are the test of a Base Script; no unit tests on internals except where a pure function is shared by three languages (serialisation, path normalisation, check diff). Fixture = the spec.

### Unit Tests

Django (`base-scripts/django/tests/`, pytest, no Django boot):
- `test_paths_normalize`: `path("api/<int:pk>/")` → `/api/{pk}/`; `re_path(r"^items/(?P<slug>[\w-]+)$")` → `/items/{slug}`; unnamed group → `{param}`; nested prefixes joined; trailing slash preserved; leading slash added.
- `test_inventory_canonical_bytes`: a hand-built inventory serialises to the committed `schema/samples/canonical.json` byte for byte (key order, one endpoint per line, sort by path then method then handler, `\n` terminated, unicode unescaped).
- `test_inventory_sort`: `/a` `POST` before `/a/b` `GET`; `ANY` sorts before `DELETE`; same path + method → handler order.
- `test_inventory_validate_dimension_keys`: endpoint with dimension key not declared → `ValidationError` naming endpoint.
- `test_inventory_validate_coverage_note`: `best-effort` with `coverage_note: null` → error.
- `test_check_diff`: committed vs current with one added (unknown), one removed, one authn change → lines `+ GET /x (h) authentication=unknown authorization=unknown [unknown]`, `- POST /y (h)`, `~ GET /z (h) authentication.value: required -> optional`; header fields diff as `~ project_dimensions: old -> new`; reordered/reformatted committed file → no diff (structural compare). Exit codes (0 clean, 1 drift, 2 missing/unreadable `inventory.json`) are covered by the fixture tests.
- `test_rules_precedence`: method outcome beats class beats global beats framework-default; custom permission with no rule → `unknown`; `IsAuthenticatedOrReadOnly` GET → `optional`, POST → `required`.
- `test_dimensions_assign_missing`: no matching rule → `MissingDimension` naming the endpoint; two matching → first (most specific) wins.
- `test_boot_stub_rules`: a `Stub` whose target is a settings module path → `BootError("settings module may not be stubbed")`; `Pin("DEBUG", True)` → `BootError("pin must move toward production")` (allow-list: `DEBUG=False`, `ALLOWED_HOSTS`, flags listed with reason).

NestJS (`base-scripts/nestjs/tests/`, vitest, no boot):
- `inventory.canonical.spec.ts`: `schema/samples/canonical.json` byte for byte.
- `check.spec.ts`: same three-way diff as Django.
- `rules.spec.ts`: `when_metadata` rule before the default rule ⇒ public route `anonymous`, others `required`; `raw_metadata` appends the roles; passport `AuthGuard('jwt')` ⇒ `required`; `ThrottlerGuard` ⇒ no finding; custom guard without rule ⇒ `unknown`.
- `boot.spec.ts`: `NODE_ENV` not `production` ⇒ `BootError`; stub on a guard ⇒ `BootError`; reasons required.
- `paths.spec.ts`: `:id` ⇒ `{id}`, wildcard ⇒ `{name}`, prefix joins.

Spring (`base-scripts/spring/src/test/java/accessinspector/` plain JUnit, no context):
- `InventoryCanonicalTest`: same `schema/samples/canonical.json` byte for byte via Jackson writer.
- `CheckDiffTest`: same three-way diff as Django.
- `RulesPrecedenceTest`: builtin SpEL set classification; `@bean.call()` → `unknown`; `@RolesAllowed({"USER","ADMIN"})` raw = both.

Symfony (`base-scripts/symfony/tests/`, PHPUnit, no kernel):
- `InventoryCanonicalTest`, `CheckDiffTest`, `RulesPrecedenceTest`: mirrors. Attribute parsing: `#[IsGranted('ROLE_ADMIN')]` → `required` + `rule`; expression attribute → `unknown`.

Cross-language:
- `schema/samples/canonical.json` + `schema/samples/canonical.input.json` (neutral input): the four canonical tests consume the same input and must produce the same bytes. Any divergence fails exactly one language's test, pointing at its serialiser.
- `test_schema_samples_valid` (Python, `jsonschema`): every `fixtures/*/expected/inventory.json` and `schema/samples/canonical.json` validate; a mutated sample with `authentication.value: "sso"` fails.

Review package (`review/tests/`, vitest, inventories and events built in the test; `today` injected):
- `test_review_key_strips_line`: `moi/api/x/view.py:27` → `moi/api/x/view.py`; dotted name unchanged; `a.py:12:3`-like oddities only strip the last `:\d+`.
- `test_fold_head`: HEAD with GET's classification folded into the GET row; HEAD differing in authorization kept as its own row.
- `test_inside`: zone with expectation, both axes listed → true; one axis not listed → false; two dimensions, one says no → false; no `expected_access` entry → null.
- `test_log_serialize_bytes`: each event type serialises to its committed sample line in `review/tests/samples/*.jsonl` (key order, compact, omitted optionals).
- `test_log_read_errors`: merge marker line → `{line: 3, message}`; `v: 2` → "newer toolkit"; `finding` without `severity` → error; missing file → empty, no error.
- `test_schema_agrees`: every sample line validates against `schema/review-event.schema.json` (ajv); every invalid sample is rejected by both ajv and `readLog`.
- `test_latest_wins`: two `reviewed` on one key, the later `at` wins; equal `at` → later line wins.
- `test_outdated_inside_value_change`: inside, seen required/none, now required/rule → outdated; now raw `LoginRequiredMixin` with same values → valid.
- `test_outdated_outside_any_change`: outside, seen raw `A`, now raw `B` same values → outdated; evidence or handler line change only → valid.
- `test_moot`: seen `inside: false`, now inside → valid + `moot`.
- `test_accepted_until`: `until` yesterday → outdated; today → valid.
- `test_orphan`: key not in inventory → in `orphans`, not in `rows`; handler moved file → orphan + new row in queue.
- `test_agent_events`: `signal_raised` valid → tier ≤ 7 signal `agent`; classification changed since → dropped; valid human Verdict on key → no agent signal; `triaged` → no signal, `agent: triaged`.
- `test_sibling`: `POST /observations/` rule vs `PUT /observations/{id}/` none → both get `sibling` naming the other; same handler, GET optional + POST required both `builtin:IsAuthenticatedOrReadOnly` → no sibling.
- `test_tiers`: one row per tier 1–11 built to match only that tier; a row matching tiers 6 and 8 → 6; `ANY` counts as unsafe.
- `test_queue_order_and_exit`: valid `safe`/`accepted` out of queue; valid `finding` tier 1; order tier, path, method by code point.

### Integration Tests

Golden files (one per fixture; run the vendored `tools/access-inspector/` inside the fixture, compare bytes with `expected/inventory.json`):
- `test_django_golden` (`fixtures/django-demo`): asserts, through the golden file, the UF1 acceptance list: unnamed view present; duplicate-name views both present; `IsAuthenticatedOrReadOnly` split per method; `@action(permission_classes=)` and `get_permissions()` override reflected at layer `method`; admin endpoints `required`/`global`/`is_staff`; `i18n_patterns` → one endpoint per language; `@require_http_methods(["POST"])` → single `POST`; function view without restriction → `ANY`; custom `IsOwner` → `unknown` + `unknown_reason` from the fixture's Acknowledged Unknown; `TenantMiddleware` Recognition Rule → `/api/*` authentication `required` layer `global`, `rule: recognition:tenant_middleware`; `/graphql/` authorization `unknown` with reason; dimension `access_tier` on every endpoint; explicit `permission_classes` → layer `class`, inherited `REST_FRAMEWORK` default → `global`; view with no check → `builtin:no_check` at `framework-default`; non-Django callable → `unknown` on both axes with a reason naming it.
- `test_django_check_clean`: `--check` against the golden, reversed and re-indented → exit 0, `inventory up to date`, no write.
- `test_django_check_missing_inventory`: no `inventory.json` → exit 2, hint to generate it first.
- `test_django_check_drift`: copy fixture, change the `refund` action's `IsAdminUser` → `AllowAny` → exit 1, diff shows `~ POST /api/orders/{pk}/refund/ (…) authorization.value: rule -> none`; authentication unchanged (the `TenantMiddleware` rule keeps it `required`); regenerate hint; `inventory.json` untouched.
- `test_django_check_missing_dimension`: add a view under a prefix no dimension rule covers → exit 2 naming the endpoint.
- `test_django_boot_failure`: fixture settings pointing to a missing secrets module without stub → exit 2, stderr contains import error and `ENTRY`; no `inventory.json` written.
- `test_django_unknowns_output`: `--unknowns` → JSON lines containing exactly the `/graphql/`, `IsOwner` (one per served method) and non-Django callable endpoints, each with its `unknown_reason`.
- `test_django_table_no_write`: `--table` prints ≥ 1 row per endpoint, mtime of `inventory.json` unchanged.
- `test_django_determinism`: run twice, byte-equal; run from another cwd, byte-equal.
- `test_nestjs_golden` (`fixtures/nestjs-demo`, `inspect.sh`): public route ⇒ `anonymous`/`global` `recognition:`; others `required`/`global`; `@Roles` ⇒ `rule` at the layer `RolesGuard` is attached (`class` in the fixture), raw with roles; passport guard ⇒ `builtin:`; `ThrottlerGuard` absent from raws; unguarded controller ⇒ `builtin:no_check`; `@All()` ⇒ `ANY`; `HEAD` beside each `GET`; global prefix applied except on the excluded path; versioned path; `RouterModule` path; Express router ⇒ `unknown` with reason; middleware rule ⇒ `/api/partner/*` `required`; body-reading guard ⇒ acknowledged.
- `test_nestjs_check_drift`: copy fixture, drop `@Roles('admin')` from one handler ⇒ exit 1, diff `authorization.value: rule -> none`.
- `test_nestjs_boot_failure`: missing required env var ⇒ exit 2 naming the entry module, no file written.
- `test_nestjs_jest_smoke` (`fixtures/nestjs-jest-smoke`): `inspect.sh` picks jest, writes the 2 expected endpoints.
- `test_spring_golden` (`fixtures/spring-demo`, `./mvnw test` in fixture): `permitAll` matcher → `anonymous`/`global`; `anyRequest().authenticated()` → `required`; second chain via `securityMatcher` → raw names that chain; `@PreAuthorize("hasRole('ADMIN')")` → `rule`/`method`; interface mapping → implementing class handler; `/actuator/health`, `/error` present; `@RolesAllowed` raw lists both; `@permissionEvaluator` → `unknown`; `@RequestMapping` without method → `ANY`.
- `test_spring_check_drift`: same shape as Django via `inspect.sh --check` after editing one matcher.
- `test_spring_gradle_smoke` (`fixtures/spring-gradle-smoke`): `inspect.sh` picks `gradlew`, writes an inventory with the 2 expected endpoints.
- `symfony_golden` (`fixtures/symfony-demo/tests/golden.sh`, bash like Spring): `access_control` `^/admin` → `required`+`rule`/`global`; firewall `security: false` → `anonymous`/`global`; `#[IsGranted]` → `rule`/`method`; API Platform resource-level security inherited by operations, override on one operation; `denyAccessUnlessGranted` → `unknown` + reason; `api_doc`/`api_entrypoint` ordinary endpoints; route without methods → `ANY`; metadata factory removed → API Platform endpoints `unknown` with reason, exit 0.
- `test_symfony_check_drift`: mirror.
- `test_parse_access_inspector` (`../skills/security-audit`, bash + jq on `fixtures/django-demo/expected/inventory.json`): summary counts match; `=== ANONYMOUS ===` lists expected paths; acknowledged vs unexplained separated.

Review CLI (`review/tests/cli.spec.ts`; copy `fixtures/django-demo` into a tmp dir with `tools/access-inspector/inventory.json` = its `expected/inventory.json`; `GIT_CONFIG_GLOBAL` pointing to a tmp gitconfig with an email):
- `test_review_status_golden`: with `review/tests/samples/django-demo.reviews.jsonl` (one of each state: valid, outdated, moot, orphan, finding, agent signal, triaged) → stdout equals `review/tests/expected/django-demo.status.txt`; run twice and from another cwd → identical.
- `test_review_status_json`: `--json` → one parseable `Row` per queued endpoint, same order as text.
- `test_review_status_missing_inventory`: exit 2, "fit the project first".
- `test_review_status_bad_log`: line 2 = `<<<<<<< HEAD` → exit 2, "reviews.jsonl line 2".
- `test_review_append_verdict`: `append --verdict safe --reason r GET /api/orders/` → one line appended (two with folded HEAD), previous bytes untouched, `.gitattributes` created with `reviews.jsonl merge=union`, `by` = the tmp email.
- `test_review_append_refusals`: unknown path; no `--reason`; `finding` without `--severity`; `--ticket` on `safe`; no git email; `--agent` with `--verdict` → each exit 2, file bytes unchanged.
- `test_review_append_ambiguous`: two endpoints same method+path, different handlers → exit 2 asking for `--handler`; with it → ok.
- `test_review_append_agent_batch`: stdin 3 lines (2 `signal_raised`, 1 `triaged`) → 3 lines, one shared `batch`, `by` = `agent:<model>`.
- `test_review_union_merge`: two git branches each append a Verdict on one key, merge → no conflict, both lines kept, `status` shows the later.
- `test_review_inventory_untouched`: after every CLI test, inventory bytes equal the fixture's.

Review app (`apps/review/tests/e2e/`, Playwright against `review app` on a tmp copy of `fixtures/django-demo` + sample log):
- `test_queue_matches_status`: rows and tiers on `/` equal `status --json` for the same files.
- `test_save_verdict`: open a tier-8 row, save `safe` with a reason → row leaves the queue, next tier-8 row selected, "1 event not committed", log has the line.
- `test_save_finding_requires_severity`: save `finding` without severity → field error, log unchanged.
- `test_outdated_panel`: outdated row shows seen vs current and the previous reason prefilled.
- `test_external_change_reflected`: append a line with the CLI while the app runs, reload → row gone without restart.
- `test_bulk_review` (5f): filter tier 11, review selection → one line per selected endpoint, one batch in History.
- `test_bulk_open_finding_confirm` (5f): selection holding a `finding` → named, nothing written until confirmed.
- `test_orphan_copy_reason` (5f): renamed endpoint shows the orphan candidate; copy + save → new key reviewed, orphan still in History.
- `test_localhost_only`: server bound to `127.0.0.1`.

Access map (Phase 9):
- `test_map_golden` (`fixtures/django-demo`, pytest): `introspect.py` writes `expected/runtime.json` byte for byte; twice and from another cwd ⇒ identical; `--check` clean ⇒ 0; a removed grant ⇒ 1 with the diff; boot failure ⇒ 2.
- `test_map_rules` (Base Script pytest, no boot): each commented example in `project.py`, uncommented on a sample, returns facts with `at`; `runtime.py` serialisation and diff.
- `map/tests/roles.spec.ts`: reach table of §1 for every `who` kind × role kind, `includes` transitive, `staff` through an included role; no hard-coded role id.
- `map/tests/cells.spec.ts`: pass, partial, no, off, open; weakest basis; scope only on pass/partial; fingerprint stable under reordering.
- `map/tests/vocabulary.spec.ts` ⚪: pin/stale (prototype) + term absent from `CONTEXT.md` ⇒ problem; duplicate of a Map Rule ⇒ problem; schema-invalid ⇒ `VocabularyError`.
- `map/tests/cli.spec.ts`: exit codes of §1 on `fixtures/django-demo` copies (stale pin, runtime mismatch, undecided partial, outdated decision ⇒ 1; invalid vocabulary ⇒ 2; decided ⇒ 0); `decide` refusals (no reason, `finding` without severity, unknown capability or role) ⇒ 2, log unchanged.
- `review/tests/replay.spec.ts` 🔵: `decided` valid / outdated (fingerprint changed, `until` passed) / orphaned; `v` 2 lines validated by ajv against the schema.
- `apps/review/tests/e2e/map.spec.ts` (9b): decide the fixture's partial `finding` high ⇒ one line, alert moves to open findings, "1 event not committed"; the static page built from the same files shows the same cell states and alert count (Playwright on both).

Triage (not automated, like the Agent): manual run on `fixtures/django-demo` then moi; acceptance in Phase 5d Verify.

Agent (not automated in v1, PRD decision): acceptance = first real Django project fitted and merged; for NestJS, `~/Theodo/bootstrap-test` fitted. Manual checklist in `assets/summary-template.md` (every rule has evidence that exists, `--unknowns` empty, `--check` green, no pipeline file touched, branch created).

---
## 5. To Do List

Phases follow the UF slicing. Phase 0 is the contract every UF depends on. Phases 1–3 (Django) deliver the first milestone; 4–7 can run in parallel after it.

### Phase 0 — Contract (prerequisite for all UFs)

- [x] **Write the schema**
  - File: `schema/inventory.schema.json`
  - Encode §2 exactly: enums, key `required` lists, `additionalProperties: false`, `if/then` for `coverage_note`.
- [x] **Write the canonical samples**
  - Files: `schema/samples/canonical.input.json`, `schema/samples/canonical.json`
  - Neutral 7-endpoint input (incl. `ANY`, unicode path, two methods on one path, two handlers on one path + method, one unknown, one dimension) and its byte-exact canonical form, hand-verified once; `schema/samples/canonical-empty.json` pins the empty form.
- [x] **Repo tooling**
  - Files: `Makefile`, `.github/workflows/ci.yml`, `base-scripts/django/pyproject.toml` (uv, ruff, mypy strict, pytest, jsonschema dev-only), `VERSION`
  - Copy conventions from `django-access-inspector/pyproject.toml` + `Makefile`.
- [x] **Write tests**
  - File: `base-scripts/django/tests/test_schema.py`
  - Test: `test_schema_samples_valid` — samples validate; mutated `authentication.value: "sso"` fails.
- [x] **Verify**: `make test-django` green with only schema tests.

### Phase 1 — UF1 Inventory a Django project

- [x] **Inventory model + canonical writer + validate**
  - File: `base-scripts/django/access_inspector/inventory.py`
  - Dataclasses per §2; `to_canonical_json`; `validate` (dimension keys, coverage note); sort `(path, method, handler)`.
- [x] **Path normalisation**
  - File: `base-scripts/django/access_inspector/paths.py`
- [x] **Discovery**
  - File: `base-scripts/django/access_inspector/discovery.py` (⚪ from `url_analyzer.py`)
  - Yield `RawEndpoint`; exotic pattern → unknown reason, never raise.
- [x] **Built-in rules + rule engine**
  - File: `base-scripts/django/access_inspector/rules.py`
  - `BUILTIN` table (PRD mapping), precedence, `RECOGNITION=[]`, `ACKNOWLEDGED=[]` templates with commented example.
- [x] **Classifier**
  - File: `base-scripts/django/access_inspector/classify.py`
  - Admin / ViewSet+actions / APIView / CBV / function; explicit-vs-default layer; handler location; HTTP methods incl. `ANY`.
- [x] **Boot template**
  - File: `base-scripts/django/access_inspector/boot.py`
  - `ENTRY`, `STUBS`, `PINNED`, guard rules (no settings-module stub, pins toward production only).
- [x] **Dimensions template**
  - File: `base-scripts/django/access_inspector/dimensions.py`
  - `DIMENSIONS={}` default → `dimensions: {}` on every endpoint; `assign` raises on miss.
- [x] **Entrypoint + table**
  - Files: `base-scripts/django/access_inspector/inspect.py`, `base-scripts/django/access_inspector/table.py`
  - `--table`, `--unknowns`; exit codes 0/2.
- [x] **Django fixture**
  - Dir: `fixtures/django-demo/` (⚪ seed `demo_views/`, `settings.py`)
  - Add every construct listed in §3 AB; vendored `tools/access-inspector/` with one Recognition Rule (`TenantMiddleware`), one Acknowledged Unknown (`IsOwner`), `/graphql/` ack, dimension `access_tier`; produce `expected/inventory.json`, review it by hand once.
- [x] **Write tests**
  - Files: `base-scripts/django/tests/test_paths.py`, `test_inventory.py`, `test_rules.py`, `test_dimensions.py`, `test_boot.py`, `fixtures/django-demo/tests/test_golden.py`
  - Tests: `test_paths_normalize`, `test_inventory_canonical_bytes`, `test_inventory_sort`, `test_inventory_validate_*`, `test_rules_precedence`, `test_dimensions_assign_missing`, `test_boot_stub_rules`, `test_django_golden`, `test_django_unknowns_output`, `test_django_table_no_write`, `test_django_determinism`, `test_django_boot_failure`, `test_django_check_missing_dimension`.
- [x] **Verify**: `make test-django` green; `expected/inventory.json` reviewed line by line against UF1 acceptance list.

### Phase 2 — UF2 Enforce the inventory in CI

- [x] **Check diff**
  - File: `base-scripts/django/access_inspector/inventory.py` (`check`), `inspect.py` (`--check`, exit 1, never writes)
- [x] **CI snippets**
  - Files: `assets/ci-snippets/github-actions.yml`, `gitlab-ci.yml`, `generic.sh`
  - Templates shared by every stack: the Agent fills `{{setup}}` (the project's own toolchain setup), `{{install}}` (project deps only) and `{{check}}` (e.g. `python tools/access-inspector/inspect.py --check`).
- [x] **Write tests**
  - Files: `base-scripts/django/tests/test_check.py`, `fixtures/django-demo/tests/test_golden.py`
  - Tests: `test_check_diff`, `test_check_ignores_ordering_and_whitespace`, `test_check_header_change`, `test_django_check_clean`, `test_django_check_drift`, `test_django_check_missing_inventory`.
- [x] **Verify**: drift test diff output matches UF2 wording (added/removed/changed + hint).

### Phase 3 — UF3 Fit a Django project with the Agent (+ UF4 dimensions, UF5 update) — first milestone

- [x] **Skill workflow**
  - File: `SKILL.md`
  - Steps 1–8 of §3 AF; hard rules; update-mode branch (UF5): detect existing dir, diff rules' evidence against current tree, remove/relocate, run `--unknowns` only; optional Base Script refresh keeping `boot.py`/`rules.py`/`dimensions.py`.
- [x] **Django reference**
  - File: `references/django.md`
  - Production entry heuristics (`config/settings/production.py`, `DJANGO_SETTINGS_MODULE` in Dockerfile/Procfile), boot failure → stub cookbook, built-in rule table, blind spots.
- [x] **Dimension proposal (UF4)**
  - File: `SKILL.md` step 6 + `references/django.md` section "candidate dimensions" (prefix groups, middleware, admin, roles seen in rules) → AskUserQuestion confirm/rename/reject → write `dimensions.py`.
- [x] **Summary template + commit**
  - File: `assets/summary-template.md`; branch name follows the project's convention (inferred from recent branch names, e.g. `feat/...`, `chore/...`; fallback `access-inspector/fit`), commit message lists rules/unknowns/boot decisions.
- [x] **Verify (manual, milestone)**: fit `~/Theodo/perenco/action-tracking`; checklist: branch exists, `--unknowns` empty, `--check` green, every evidence `file:line` exists, no pipeline file in the diff, dimensions confirmed by the user. Then re-run in update mode on the same project → no diff.

### Phase 4 — UF6 Audit from the Committed Inventory (sibling repo `../skills/security-audit`) — https://github.com/BastienTeissier/skills/pull/2

- [x] **Reference + parse script**
  - Files: `references/access-inspector.md`, `scripts/parse_access_inspector.sh`
- [x] **Retire Django-specific scanner**
  - Files: delete `references/django-access-inspector.md`, `scripts/parse_django_access_inspector.sh`; update `references/scan.md`, `SKILL.md` step 4.
  - Staleness: run `--check` if the Adapted Script is runnable, else skip; on exit 1 → "stale" banner in report; never regenerate.
- [x] **Write tests**
  - File: `../skills/security-audit/scripts/tests/test_parse_access_inspector.sh` (bats or plain bash) on `fixtures/django-demo/expected/inventory.json`.
- [x] **Verify**: run the security-audit skill on `fixtures/django-demo` → report has mode/coverage header, anonymous list, acknowledged vs unexplained sections.

### Phase 5 — UF10 Inventory a NestJS project

- [x] **Runner + boot + discovery**
  - Files: `base-scripts/nestjs/{inspect.sh,vitest.config.ts,jest.config.cjs,run.spec.ts,boot.ts,discovery.ts,paths.ts}`
- [x] **Guards + rules**
  - Files: `classify.ts`, `rules.ts` (builtins, `NEUTRAL`, `whenMetadata`, `rawMetadata`: camelCase in TypeScript; a `null` value matches an absent key)
- [x] **Inventory + check + table + dimensions**
  - Files: `inventory.ts`, `dimensions.ts`, `table.ts`
- [x] **Toolkit tooling**: `base-scripts/nestjs/package.json` (dev only: typescript, vitest, `@nestjs/*`), `Makefile` `test-nestjs`, CI job with Node only. `make check-all` adds `typecheck-nestjs`; CI's Django job runs `lint typecheck deps`.
- [x] **Fixtures**: `fixtures/nestjs-demo/` per §3 AS, `fixtures/nestjs-jest-smoke/` per §3 AT. The demo's global `APP_GUARD` covers every Nest route, so `builtin:no_check` is exercised by the jest smoke fixture.
- [x] **Reference**: `references/nestjs.md` (production entry = the module and setup function `main.ts` uses; `.env` files read by `ConfigModule` vs `ENVIRON`; stub cookbook for providers connecting at init; built-in table; metadata rules; blind spots: middleware, checks inside handlers or services, Fastify routes outside Nest, guards reading metadata with `get`/`getAllAndMerge`; Nest version tested). `SKILL.md` step 1 adds the NestJS row; vendoring copies `base-scripts/nestjs/` minus toolkit files; linter exclusions cover eslint, prettier, tsc and dependency-cruiser.
- [x] **Write tests**: §4 NestJS unit tests, `test_nestjs_golden`, `test_nestjs_check_drift`, `test_nestjs_boot_failure`, `test_nestjs_jest_smoke`, canonical bytes shared with Python.
- [x] **Verify**: `make test-nestjs` green; fit `~/Theodo/bootstrap-test` (`apps/backend`, `ENTRY` `AppModule`, `CONFIGURE` `configureApp`, `ENVIRON` `NODE_ENV=production` + placeholders for `DATABASE_URL`, `JWT_SECRET`, `ALLOWED_ORIGIN`): `AuthGuard` rules on `isPublic` (anonymous) and default (required), `RolesGuard` rule with `raw_metadata: roles`; expected 14 endpoints, `/auth/login`, `/auth/logout`, `/auth/refresh`, `POST /users`, `/health/*` anonymous, `/users/me` required/none, `GET /users` and `PATCH /users/{id}` required/rule; no Swagger route (`NODE_ENV=production`); `--unknowns` empty, `--check` green.

### Phase 5b — UF11 View the inventory

- [x] **Schema** (stays `"1"`, no user yet)
  - File: `schema/inventory.schema.json`, `schema/samples/*`
  - Axis `evidence` (`file:line` of the Recognition Rule; null for builtin and unknown); endpoint `acknowledged` (true iff an Ack produced the `unknown_reason`); top-level `expected_access` `{dimension: {value: {authentication: [...], authorization: [...]}}}` (no `unknown`), from `EXPECTED` in the dimensions project section.
- [x] **Django + NestJS Base Scripts**: emit, validate and `--check` the new fields; `EXPECTED` keys and values must be declared in `DIMENSIONS`; VERSION 0.3.0; regenerate goldens; vendored copies synced.
- [x] **Viewer**
  - File: `viewer/inventory-viewer.html`: one self-contained file (no CDN, system fonts, light/dark), opens `inventory.json` by file picker or drag-and-drop; Triage, Zones (dimension picker, mismatch flag against `expected_access`), detail drawer with layers, rules and evidence; HEAD folded into GET when identical.
- [x] **Skill**: `SKILL.md` step 6 proposes `EXPECTED` per value; step 7 points the user to the viewer; references and summary template mention `EXPECTED`.
- [x] **Write tests**: unit tests for evidence, acknowledged and `EXPECTED` validation in both stacks; goldens; canonical bytes.
- [x] **Verify**: `make check-all`, `make test`; open the viewer on `fixtures/nestjs-demo/expected/inventory.json` and `fixtures/django-demo/expected/inventory.json`.

### Phase 5c — UF12 Track reviews from the command line

- [x] **Tooling**: `review/{package.json,tsconfig.json,vitest.config.ts}` (BA); `Makefile` `install-review`, `test-review`, `typecheck-review` wired into `test`/`check-all`; CI job `review` (BQ).
- [x] **Contract**: `schema/review-event.schema.json` (BB) + `review/tests/samples/*.jsonl` (valid + invalid lines).
- [x] **Core**: `review/src/{inventory,replay,signals,tiers}.ts` (BC, BE, BF).
- [x] **Shell**: `review/src/{log,cli}.ts` (BD, BG): `status [--json]`, `append --verdict`, `append --agent`; `app` stub exiting 2 until 5e.
- [x] **Docs**: README section "Review the inventory" (CLI usage, commit `reviews.jsonl` with the code); `SKILL.md` step 7 mentions `review status` after a fit.
- [x] **Write tests**: §4 review package unit tests; review CLI tests.
- [x] **Verify**: `make check-all`, `make test`; on moi (scratch copy, never committed there): `status` shows 514 endpoints, tiers 1–2 empty, tier 11 = the `rule` endpoints; one `append` then `status` → out of queue.

### Phase 5d — UF13 Triage the inventory with the Agent

- [x] **Skill**: `SKILL.md` `## Triage` + description + hard rule (BN); `references/{django,nestjs}.md` `## Triage checklist` (BO).
- [x] **Viewer**: Triage tab → Overview (BP); README and UF11 wording.
- [x] **Write tests**: none new beyond 5c's `append --agent` tests (Triage is Agent work, manual acceptance).
- [x] **Verify (manual)**: triage `fixtures/django-demo` copy → signals on its open writes and unscoped lookups (`IsOwner` itself holds: `get_object` checks it), `triaged` on the rest of the scope, one batch; second run reads nothing; edit one handler's guard, rerun → only it is read. Then moi scratch copy: 110 rows in scope (33 project handlers); 3 handlers sampled here (5 `triaged`, one batch), the full run is left to the user on moi; nothing changed outside `reviews.jsonl` and `.gitattributes`.

### Phase 5e — UF14 Review endpoints in the app

- [x] **App scaffold**: `apps/review/{package.json,next.config.ts,tsconfig.json}` (BM); `review app` in `cli.ts` builds on first run and starts on `127.0.0.1` (BG). `review/src/app.ts` also rebuilds when a source is newer than `.next/BUILD_ID`, and refuses outside a toolkit checkout or before `make install-review`.
- [x] **Projection**: `apps/review/lib/projection.ts` (BH). `meta` also keys on `today`, so an `accepted` Verdict expires without a log change; `endpoint.siblings` holds the sibling keys, `endpoint.position` the package's queue order, `header` the header counts; `orphans()` left to 5f. `proxy.ts` answers 403 to any Host but 127.0.0.1 and localhost (DNS rebinding).
- [x] **Queue + panel + verdict**: `app/page.tsx`, `app/endpoint-panel.tsx`, `app/actions.ts` `saveVerdict` (BI, BJ, BK); viewer CSS tokens. The form submits in a transition (`onSubmit`), not as a form action: React resets a form after its action, which lost the checked Verdict on a refusal.
- [x] **Write tests**: §4 app tests not marked 5f (`tests/projection.spec.ts`, `tests/e2e/review.spec.ts`, Playwright in `make test` and CI).
- [x] **Verify**: `make check-all`, `make test`; on the moi scratch copy, ten tier-8 endpoints reviewed in the app → `git diff` shows 12 appended lines (10 + 2 folded HEADs); cache file deleted, restart → same header and the same 473 queue rows.

### Phase 5f — UF15 Review in bulk and read the history

- [x] **Bulk**: `saveBulk` in `app/actions.ts` + selection dialog (count, sample, open-finding confirmation) (BK). The package's `appendBulk` writes the batch (folded HEADs included, one `append`); the dialog is a side panel (`?bulk=1`) sharing `VerdictForm` with the endpoint panel. The count is repeated on the submit button ("Review all N endpoints") at every size, not in a separate confirmation above 50. History counts endpoints as the panel does: a HEAD reviewed with its GET is not one more.
- [x] **History + orphans**: `app/history/page.tsx` (BL); orphan candidates and "copy reason" in the panel (BJ). Candidates only for a row without a valid Verdict; "same handler file" compares project handlers (`file:line`) only, a framework handler serves unrelated paths.
- [x] **Write tests**: §4 app tests marked 5f (`tests/e2e/bulk.spec.ts`, `tests/history.spec.ts`, package `tests/bulk.spec.ts`).
- [x] **Verify**: on the moi scratch copy, bulk-review zone `user` tier 11 → 1 batch, 375 lines (373 rows + 2 folded HEADs); one URL renamed in the scratch inventory JSON (the scratch copy holds only `tools/`, so no regeneration) → orphan shown, reason copied onto the new endpoint, orphan still in History.

### Phase 6 — UF7 Inventory a Spring project

- [x] **Runner + boot + discovery**
  - Files: `base-scripts/spring/tools/access-inspector/inspect.sh`, `src/test/java/accessinspector/{AccessInspectorRun,Boot,Discovery}.java`
  - The mode and output directory travel as environment variables `ACCESS_INSPECTOR_MODE` / `ACCESS_INSPECTOR_OUT`, not `-D` properties: Maven and Gradle both pass the environment to the test JVM, with no `systemProperty` passthrough to document. `AccessInspectorRun` is `@EnabledIfEnvironmentVariable`, so the project's own `test` skips it. Results travel through files (stdout, stderr, status) since a build only passes or fails.
  - `Boot` carries `@SpringBootTest(classes = …)` and `@ActiveProfiles` in its project section; the context loads through `TestContextManager`, so a boot failure is reported (`cannot boot <class>: <deepest cause>`), not a crashed test. Stubs are `@MockitoBean` fields with `@Reason` (`@MockBean` is removed in Boot 4); pins go through `@DynamicPropertySource`.
  - No declared method ⇒ `ANY`, split into concrete methods only when their classifications differ; HEAD beside every GET; `{name:regex}`/`{*name}` ⇒ `{name}`, `*`/`**` ⇒ `{wildcard}`.
- [x] **Filter chain + method security + rules**
  - Files: `FilterChainResolver.java`, `MethodSecurity.java`, `Rules.java`
  - Method security per family (PreAuthorize, PostAuthorize, Secured, JSR-250): the method's annotation wins over the class's, and a family counts only when its interceptor bean exists. SpEL is a builtin only as one call with quoted literals.
- [x] **Inventory + check + table + dimensions**
  - Files: `Inventory.java`, `Dimensions.java`, `Table.java`, `Json.java` (hand-written JSON, no Jackson on the project's classpath assumed)
- [x] **Fixtures**
  - Dirs: `fixtures/spring-demo/` (⚪ seed `sample/microservice-example` without Lombok, plus two chains, an interface mapping, `@RolesAllowed` with two roles, `@permissionEvaluator` with a Recognition Rule, `hasIpAddress` acknowledged, a stubbed bean failing at boot, a prod profile narrowing the actuator), `fixtures/spring-gradle-smoke/` (Gradle 9.8 wrapper)
  - Spring Boot 4.1.1 (the latest; §Decisions said 3.x before 4 shipped). `hasRole(ADMIN)` from the seed stays the real unknown; `@permissionEvaluator` gets a Recognition Rule so the evidence path is exercised.
- [x] **Reference**: `references/spring.md` (profile heuristics, `@MockitoBean` stub cookbook, filter-chain internals note + Spring Security 7 tested, blind spots: sample path vs a more specific matcher, context path, functional routes, WebFlux, static resources, Spring Security required, one module per run). `SKILL.md` stack row and terms column.
- [x] **Write tests**: `InventoryCanonicalTest`, `CheckDiffTest`, `RulesPrecedenceTest`, `FilterChainResolverTest` in the Base Script (`./mvnw test`, `-Werror`); `fixtures/spring-demo/tests/golden.sh` (golden, classifications, unknowns, table, determinism, check clean/drift/missing/unreadable, missing dimension, boot failure, usage, vendored copy); `fixtures/spring-gradle-smoke/tests/golden.sh`.
- [x] **Toolkit tooling**: `Makefile` `test-spring` in `test`, Java run in `eclipse-temurin:21-jdk` through `SPRING_RUN` (nothing installed on the host); CI job `spring` with `setup-java` 21 and `SPRING_RUN=`.
- [x] **Verify**: `make test-spring` green; reflection access to authorization mappings guarded: on failure → every endpoint global layer `unknown` with reason "Spring Security internals changed", not a crash (`FilterChainResolverTest`).
- **Deviations** (PR #12 review): Spring `entry` is the application class, the profile goes to `pinned` as `spring.profiles.active` (§2); Spring Security is required, a project without it fails to compile the vendored script (UF7 edge case amended, `spring.md` blind spot); URL-mapped handlers and an enabled method security family without its interceptor are reported (`best-effort` note, `unknown`) rather than dropped.

### Phase 7 — UF8 Inventory a Symfony project

- [x] **Entry + boot**
  - Files: `base-scripts/symfony/tools/access-inspector/inspect.php`, `src/{Boot,Kernel,Run}.php`
  - No `config/packages/access_inspector.yaml` dropped into the project: `InspectorKernel` extends the project's kernel (aliased `ProjectKernel`), builds into a fresh temp dir (never `var/cache/`), and a compiler pass publishes `security.access_map`, `security.firewall.map` and API Platform's metadata factory, resolving alias chains. A `final` kernel is a boot failure.
  - `Boot::KERNEL` + `Boot::ENV` (`APP_DEBUG=0`) + `Boot::environ()` (`Env` with reason; `APP_ENV`/`APP_DEBUG`, duplicates, empty reason refused). `ENVIRON` set first, then `.env` and `.env.<ENV>` through Dotenv, never a `*.local` file. Router and access maps read during boot, so a missing `%env()%` is a boot failure. `boot_environment.entry` = the env; `stubs`, `pinned` always `[]`.
- [x] **Discovery + access control + attributes + API Platform**
  - Files: `src/Discovery.php`, `AccessControlResolver.php`, `Attributes.php`, `ApiPlatform.php`, `Rules.php`
  - First route per method + path wins (host, condition, requirements ignored); no methods ⇒ `ANY` (remaining concrete methods behind earlier routes); HEAD beside GET; `{!x}` ⇒ `{x}`.
  - `access_control`: `path` + `methods` evaluated on the sample request; any other condition (`ips`, `host`…) or a custom request matcher ⇒ `unknown` with reason. Multi-role entry read with the default affirmative strategy. Reflection failure ⇒ `unknown` "Symfony Security internals changed".
  - `#[IsGranted]` (class then method, `methods:` filter) + Sensio `#[Security]` + `denyAccessUnlessGranted()` in the action body (one literal ⇒ builtin, else `unknown` "voter check in handler body"). API Platform `security` / `securityPostDenormalize`, handler = resource file at its single `new <Operation>(` line.
- [x] **Inventory + check + table + dimensions**: `Inventory.php`, `Dimensions.php`, `Table.php`, `Json.php`, checked against the shared samples.
- [x] **Fixture**: `fixtures/symfony-demo/`, Symfony 8.1 + API Platform 5.0 (the latest). `ips: '%env(TRUSTED_IPS)%'` entry pinned through `environ()` and acknowledged, `PROJECT_VIEW` voter with a Recognition Rule, `denyAccessUnlessGranted('EDIT', $post)` left the real unknown.
- [x] **Reference**: `references/symfony.md` (kernel subclass, `.env` loading, `EnvNotFoundException` cookbook, blind spots: route dedup by path + method, sample request, `.{_format}`, `isGranted()` in bodies, branch-blind body check, affirmative strategy, custom matchers, shell env overrides `.env`, non-final kernel). `SKILL.md` stack row and terms column.
- [x] **Write tests**: `InventoryCanonicalTest`, `CheckDiffTest`, `RulesPrecedenceTest`, `AccessControlResolverTest`, `AttributesTest`, `DiscoveryTest` (PHPUnit 12, fail on warning/deprecation); `fixtures/symfony-demo/tests/golden.sh` (bash, like Spring, not PHPUnit: golden, classifications, unknowns, table, determinism, check clean/drift/missing/unreadable, missing dimension, boot failure, environ refusal, API Platform metadata absent, usage, vendored copy).
- [x] **Toolkit tooling**: `Makefile` `install-symfony`, `test-symfony` in `test`, PHP run in `composer:2` through `SYMFONY_RUN`; CI job `symfony` with `setup-php` 8.5 and `SYMFONY_RUN=`.
- [x] **Verify**: `make test-symfony` green.

### Phase 8 — UF9 Fit an unsupported stack

- [x] **Closest-stack reference**
  - File: `references/unsupported.md`
  - Table framework → Base Script; what is kept (inventory, rules engine, dimensions, table, entry) vs rewritten (boot, discovery, classify, framework builtins, each file headed with its origin); route-registry hints (FastAPI `iter_route_contexts(app.routes)`, Flask `app.url_map`, Express `app._router.stack` / `app.router.stack`, Fastify, Laravel `getRoutes()`, Micronaut, JAX-RS, Rails, ASP.NET Core, Go); mandatory `coverage: best-effort` + note naming stack and Base Script; update mode re-base when `stack` ≠ `base_script.stack`.
- [x] **Skill branch**: `SKILL.md` step 1 fallback row, improvise or refuse when no registry and no recognisable routing, the byte-identical hard rule's exception, update mode pointer.
- [x] **Verify (manual)**: improvised a FastAPI 0.159 sample (3 routes: open, `Depends(current_user)` parameter, router-level `require_admin`) from the django Base Script: inventory validates against the schema, `best-effort`, `--check` green, drift on removing a dependency exits 1. Found that `include_router()` is no longer flattened in `app.routes`; `unsupported.md` says to use `iter_route_contexts`.

### Phase 9a — UF16, UF17 The access map: data, CLI, static page

- [x] **Contracts**: `schema/runtime.schema.json`, `schema/vocabulary.schema.json`, `review-event.schema.json` `v` 2 (CA, CB, CC).
- [x] **Review package**: `decided` events, `capability` key, decisions in `replay`, `appendDecision` (CD).
- [x] **Django Map Introspect**: port and split into `introspect.py`, `project.py`, `admin.py`, `runtime.py`; Map Rules; deterministic `runtime.json`; `--check` (CE–CH).
- [x] **Map package**: port `map/`, then `roles.ts`, `cells.ts`, `alerts.ts`, `data.ts`; `join.ts` stack-neutral; `cli.ts` `decide` and exit codes (CI–CP, CR).
- [x] **Static page**: `page.html` reduced to drawing Page data, moi strings and `localStorage` marks removed, basis borders and legend, partial state, decisions read-only (CQ).
- [x] **Fixture**: `fixtures/django-demo` grants, sign-in group, owner-filtered queryset, partial, `CONTEXT.md`; expected runtime and vocabulary (DA).
- [x] **Tooling**: Makefile and CI (CZ).
- [x] **Write tests**: §4 Access map, except `map.spec.ts`.
- [x] **Verify**: `make check-all`, `make test`; on a scratch copy of moi (never in moi): vendor the 0.4.0 introspect, move the prototype vocabulary to the new shape, `map check` lists partial cells to decide and the "could be extracted" items; the 5 prototype findings (a role reaching too much) come out as `pass` cells and are recorded with `map decide --verdict finding`; `map build` page opened, no console error. Fixed after the moi run: a role takes the scope of a role it includes when it has none of its own; `.md` references pinned, `stack` left out of pin; custom admin URLs of `stack.admin_actions` become extracted capabilities; a capability's `check` names the override that decides it.

### Phase 9b — UF18 The access map in the review app

- [x] **Pages**: `app/map/*` (CS), `saveDecision` (CT), projection (CU), History (CV). The app bundle cannot reach `review/src/cli.ts` (it boots the app at module level), so `output` moved to `review/src/output.ts` and `map check` to `map/src/check.ts`.
- [x] **Write tests**: `apps/review/tests/e2e/map.spec.ts`.
- [x] **Verify**: `make test-review`; on the moi scratch copy, decide one partial in the app ⇒ one `decided` line; static page from the same files shows the same states. The moi map has no partial left after 9a's fixes, so a `no` cell was decided instead: one `decided` line; 3234 cells and 281 alerts identical in the app and the static page; no console error.

### Phase 9c — Skill, docs and release

- [ ] **Skill**: `SKILL.md` § Map, references, summary template (CW–CY).
- [ ] **Docs**: README Access map section; `VERSION` 0.4.0 (DB).
- [ ] **Verify**: the Agent runs § Map on `fixtures/django-demo` from a clean copy and reaches the expected vocabulary's coverage; every README anchor resolves.

---
## 6. Context: Current System Architecture

### This repository
Docs only (`CONTEXT.md`, `docs/adr/`, `docs/features/`), APM config (`apm.yml`, `apm.lock.yaml`), skill copies under `.claude/skills/` (generated, untracked). No code, no tests, no CI.

### django-access-inspector (`../django-access-inspector`, v0.5.0)
- Current behavior: Django app + management command `inspect_access_control`; runtime walk of `ROOT_URLCONF`; classifies callbacks by `model_admin` / `.view_class` / `.cls` / decorators; JSON keyed by URL name with `authenticated` / `unauthenticated` / `unchecked` / `model_admin_views`; `--ci --snapshot` diffs unauthenticated+unchecked name sets.
- Current limitations: unnamed views dropped, duplicate names overwrite; any class ⇒ "authenticated" (`AllowAny` included); class-level `permission_classes` only (no `@action`, no `get_permissions`); substring greps on source as evidence; `set()` ordering; snapshot has timestamp; policy baked into CI mode; requires `INSTALLED_APPS` edit.

### spring-access-inspector (`../spring-access-inspector`, v2.3.0)
- Current behavior: Spoon static AST, no-classpath; finds `@RestController`/`@RequestMapping` classes, `*Mapping` methods incl. inherited; first `@PreAuthorize|@Secured|@RolesAllowed` value; HTML table with IDE links; Maven plugin goal `inspector:inspect`.
- Current limitations: blind to `SecurityFilterChain`; `@Controller` ignored; first annotation only; first `@RolesAllowed` element only; NPE on `path=` without `value`; test sources and `target/` scanned; unstable order; no JSON.

### accent (`../accent`, prototype)
- Current behavior: Symfony bundle, console command `theodo:access-control`; iterates `RouterInterface::getRouteCollection()`; for API Platform routes reads operation `getSecurity()`; console table; exit 1 if any route lacks an expression.
- Current limitations: non-API-Platform routes labelled and skipped; ignores `access_control`, firewalls, `#[IsGranted]`, voters; no JSON; no tests; order = route collection order.

### bootstrap-test (`~/Theodo/bootstrap-test`, NestJS fit target)
- Turborepo + pnpm; API in `apps/backend` (NestJS 12, Express, ESM, vitest, tsconfig path aliases `@modules/*`, `@auth/*`…).
- Boot: `src/openapi.ts` already creates `AppModule` without listening and opens no database connection; `src/configure-app.ts` is the HTTP setup shared by `main.ts` and tests; Swagger mounted in `main.ts` only outside production.
- Access: `AuthGuard` as `APP_GUARD` (bearer JWT, skipped when `isPublic` metadata, set by `@Public()` through the `src/decorators/http.ts` route wrappers); `@Roles()` = `SetMetadata('roles')` + `UseGuards(RolesGuard)`; `ThrottlerGuard` on login/sign-up/refresh; refresh-cookie check inside the handler.
- Env validated at boot (`src/config/env.ts`): `DATABASE_URL`, `JWT_SECRET` (≥ 32 chars, no `ChangeMe` outside development), `ALLOWED_ORIGIN` required; `ConfigModule` also reads `.env`, `.env.local`.

### security-audit skill (`../skills/security-audit`)
- Current behavior: SKILL.md orchestrates one subagent per scanner reference (`references/*.md`), parses JSON via `scripts/parse_*.sh` (jq, summary section + JSON lines), baseline file, report template.
- Current limitations: Django-specific access scanner only (`references/django-access-inspector.md`), must boot the app via `manage.py`; no notion of coverage/mode.

### moi (`~/Theodo/perenco/moi`, Phase 5c–5f acceptance target; never committed to or pushed from here)
- Django, fitted on branch `chore/all-access-inspector` (Base Script 0.3.0): 514 endpoints, 40 anonymous/none, 96 required/none, 378 required/rule, 0 unknown; `access_tier` public 40 / user 466 / superuser 8, none outside expected.
- Review-relevant: `/perseus/api/*` DRF views `IsAuthenticated` only, checks (if any) in querysets → tier 8 bulk; admin views via `admin_site` + project path-prefix rules → tier 11; handlers `moi/...py:<line>` (line stripped in the Review Key).

### Viewer (`viewer/inventory-viewer.html`, Phase 5b)
- Self-contained HTML; `fold` (HEAD into GET), `zoneCheck` (inside/outside per dimension, unknown never outside), buckets in the Triage tab, CSS tokens light/dark. Reused as the reference for BC and the app's look; only its tab label changes.

### Key Files
| File | Purpose |
|------|---------|
| `CONTEXT.md` | Glossary and rules the plan implements |
| `docs/adr/0001..0003` | Agent-once, runtime-first, vendored decisions |
| `docs/features/all-access-inspector/prd.md` + `uf1..uf9` | Requirements and acceptance per UF |
| `../django-access-inspector/django_access_inspector/services/url_analyzer.py` | URL walker to salvage |
| `../django-access-inspector/django_access_inspector/services/view_inspector.py` | Classifier to replace (defect reference) |
| `../django-access-inspector/demo_views/` | Fixture seed |
| `../django-access-inspector/pyproject.toml`, `Makefile` | Python tooling conventions |
| `../spring-access-inspector/sample/microservice-example/` | Spring fixture seed |
| `../accent/src/AccessControl/AccentReportFactory.php` | Router walk to salvage |
| `../accent/src/AccessControl/RouteAccessControlFactory.php` | API Platform metadata lookup to salvage |
| `../skills/security-audit/scripts/parse_django_access_inspector.sh` | Parse-script pattern for UF6 |
| `../skills/security-audit/references/django-access-inspector.md` | Reference-file pattern for UF6 (to be replaced) |
| `CONTEXT.md` § Review, `docs/adr/0004-review-state-is-an-event-log.md` | Review terms and the event-log decision |
| `docs/features/all-access-inspector/uf12..uf15` | Review requirements |
| `skills/all-access-inspector/viewer/inventory-viewer.html` | `fold`, `zoneCheck`, tokens to mirror |
| `skills/all-access-inspector/base-scripts/nestjs/{package.json,tsconfig.json,vitest.config.ts}` | TypeScript toolchain to mirror in `review/` |
| `skills/all-access-inspector/base-scripts/nestjs/access_inspector/inventory.ts` | `Inventory`/`Endpoint`/`Axis`/`ExpectedAccess` types to mirror |

---

## 7. Reference Implementations

- **Recursive urlpatterns walk** — `../django-access-inspector/django_access_inspector/services/url_analyzer.py` `UrlAnalyzerService.extract_views_from_urlpatterns`: URLPattern/URLResolver/namespace/`LocaleRegexURLResolver` handling; reuse structure, replace `TypeError` with unknown endpoint, keep `pattern` parts.
- **Callback shape detection** — `../django-access-inspector/django_access_inspector/services/view_inspector.py`: the `model_admin` / `view_class` / `cls` / `initkwargs` branch order is right; everything after it (name substrings, source greps, "any class = authenticated") is what §3 G replaces. Also shows `get_default_classes` reading `REST_FRAMEWORK` settings.
- **Fixture breadth** — `../django-access-inspector/demo_views/views.py`, `django_native_views.py`, `urls.py`: decorator vs attribute vs `@action` override, Django decorators/mixins, DRF router registration; extend per §3 AB.
- **Python tooling** — `../django-access-inspector/pyproject.toml` (uv, ruff, mypy strict with django-stubs, pytest-django, coverage gate) and `Makefile` (`validate` = lint+typecheck+test).
- **Router iteration + API Platform metadata** — `../accent/src/AccessControl/AccentReportFactory.php` (route collection loop), `RouteAccessControlFactory.php` (`_api_resource_class` / `_api_operation_name` → `ResourceMetadataCollectionFactoryInterface` → `getOperation()->getSecurity()`, exception handling for missing resource/operation).
- **NestJS boot without listen** — `~/Theodo/bootstrap-test/apps/backend/src/openapi.ts` (`NestFactory.create` + `close`), `src/test/app.ts` (`Test.createTestingModule({imports: [AppModule]})`, overrides, `configureApp`): the boot path of `boot.ts`.
- **NestJS metadata guard** — `~/Theodo/bootstrap-test/apps/backend/src/modules/auth/{auth.guard,roles.guard,roles.decorator,public.decorator}.ts`: `Reflector.getAllAndOverride` on handler then class; the shape `when_metadata`/`raw_metadata` must express.
- **Spring sample controllers** — `../spring-access-inspector/sample/microservice-example/src/main/java/com/theodo/ms/controller/{Cars,Another,Houses,Trees}Controller.java`: `@RolesAllowed`, `@Secured`, `@PreAuthorize` with `isAuthenticated()`/`permitAll()`, class-level `@PreAuthorize`; seed for the Spring fixture.
- **Scanner reference + parse script pattern** — `../skills/security-audit/references/semgrep.md` + `scripts/parse_semgrep.sh`: sections `=== X SUMMARY ===` then JSON lines; `jq -c` per finding; `set -euo pipefail`, jq presence check; replicate for `parse_access_inspector.sh`.
- **Skill structure** — `../skills/security-audit/SKILL.md`: numbered workflow, `references/` discovery, `assets/` templates, AskUserQuestion at decision points; model for `SKILL.md` here.
- **Inventory types and canonical writer (TS)** — `base-scripts/nestjs/access_inspector/inventory.ts`: `Axis`, `Endpoint`, `Inventory`, `ExpectedAccess` types and the hand-rolled per-line `JSON.stringify`; copy the types into `review/src/inventory.ts` (the review package may not import vendored code), mirror the writer style in `log.ts serialize`.
- **Test helpers (TS)** — `base-scripts/nestjs/tests/samples.ts` `endpoint(method, path, handler)` builder: same shape for review unit tests.
- **Golden CLI test with tmp copy (TS)** — `fixtures/nestjs-demo/tests/golden.spec.ts`: `mkdtempSync` + `cpSync` fixture, `spawnSync` the script, `edit()` helper, exit-code + stdout assertions; template for `review/tests/cli.spec.ts`.
- **HEAD folding + zone check** — `viewer/inventory-viewer.html` `fold()` and `zoneCheck()`: port to `inventory.ts` `foldHead`/`inside` with the same rules so the viewer and the app agree.
- **Visual tokens** — `viewer/inventory-viewer.html` `:root` + dark-mode blocks: copy into `apps/review/app/globals.css`.
- **Skill section style** — `SKILL.md` § Update mode: numbered steps, hard rules restated; model for § Triage.

---

## Notes

- Phases 1–3 are the first milestone; do not start 5–8 before a real Django project is fitted, the contract will move.
- Spring filter-chain reflection: record the Spring Security version tested in `references/spring.md`; guard with the "internals changed ⇒ unknown" fallback.
- `.claude/skills/` is APM-generated; keep untracked unless decided otherwise.

## Unresolved questions

None.

## Resolved during planning

- Environment variables read at settings import (found fitting action-tracking): `boot.py` pins them in `ENVIRON` (`Env(name, value, reason)`), applied before the settings import and overriding the shell; recorded in `boot_environment.environ`.
- Vendored code vs project linters (found fitting action-tracking: ruff complexity cap, mypy): the fit excludes `tools/access-inspector/` in each linter's config, the one change allowed outside it; the Base Script keeps the toolkit's own style.
- Distribution: this repository is an APM package; users add it as a dependency pinned by tag. The toolkit (`SKILL.md`, `references/`, `assets/`, `base-scripts/`, `schema/`, `VERSION`) lives under `skills/all-access-inspector/`, so it deploys as one skill; toolkit paths in this plan are relative to that directory. Fixtures stay at the repository root.

- Milestone target: `~/Theodo/perenco/action-tracking`.
- NestJS (added 2026-10-12): Phase 5, before Spring; `~/Theodo/bootstrap-test` is the fit target only, the fixture is written from scratch; the script runs through the project's own test runner (vitest or jest); guard rules carry a metadata condition (`when_metadata`), first matching rule per construct wins.
- Spring handlers: dotted names without lines, for all handlers.
- Fixtures on latest framework versions (as built: Spring Boot 4.1, Symfony 8.1, API Platform 5.0).
- Kotlin controller in the Spring fixture: deferred.
- Agent branch naming: project convention, inferred from recent branches.
- Review package location (2026-10-15): `skills/all-access-inspector/review/`, so Triage works from an APM-installed skill; zero-dependency TypeScript run by Node 24. The Next.js app stays at `apps/review/` and runs from a toolkit checkout.
- Review projection (2026-10-15): `node:sqlite` (built into Node 24), not `better-sqlite3` (native build); disposable, rebuilt on file change.
- Review phases ship before Spring as 5c–5f, so open phases keep their numbers.
