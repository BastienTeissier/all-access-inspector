# Implementation Plan: All Access Inspector

PRD: [prd.md](./prd.md). Vocabulary: [CONTEXT.md](../../../CONTEXT.md). Decisions: [docs/adr](../../adr/).

## 1. Feature Description

**Objective**: toolkit = one shared inventory schema + one runtime Base Script per stack (Django, Spring, Symfony) + fixtures with golden inventories + a Claude Code skill (the Agent) that vendors a Base Script into a project, pins its boot, resolves unknowns with cited Recognition Rules, and commits on a branch. Afterwards the project regenerates / `--check`s its inventory with no LLM.

**Key Capabilities**:
- **CAN** enumerate every endpoint the framework mounts (runtime), classify authn/authz per HTTP method into a closed vocabulary, keep raw expressions, emit `unknown` honestly.
- **CAN** diff against a Committed Inventory (`--check`, exit 1 + per-endpoint diff), render a table (`--table`).
- **CAN** be fitted by the Agent: stack detect → vendor → boot (toward-production stubs) → unknown loop → Project Dimensions (propose/confirm) → commit on branch + summary. Update mode preserves existing rules.
- **CAN** feed the security-audit skill from the committed JSON, stack-agnostic.
- **CANNOT** evaluate rules into role matrices, inspect GraphQL/WebSocket operations, merge several apps' inventories, enforce a policy (only diffs), publish Base Scripts as packages.
- **CANNOT** (Agent) edit CI pipelines, stub a settings module, move a routing-shaping setting away from production, claim `complete` on an unsupported stack.

**Business Rules**:
- Endpoint identity = (method, path, handler). Method `ANY` when handler declares no restriction; per-method rules (`IsAuthenticatedOrReadOnly`) expand to explicit methods.
- Path: leading `/`, params as `{name}`, trailing slash as declared.
- Handler: project code → `relative/path.py:line` (Django, Symfony); framework code → dotted name, no line. Spring: dotted name for all handlers (no line available at runtime).
- Core Classification closed: authentication `anonymous|optional|required|unknown`, authorization `none|rule|unknown`, layer `global|class|method|framework-default`. Identity check alone = `required` + `none`. Custom construct without rule = `unknown`.
- Inventory byte-stable: sorted by path then method (alphabetical), fixed key order, no timestamps, no absolute paths.
- Fitting complete ⇔ every `unknown` has `unknown_reason`; every Recognition Rule cites existing `file:line`.
- Project Dimension: declared values only; endpoint without value ⇒ script fails naming endpoint.
- Static discovery only when routing not enumerable; reason written in Adapted Script; coverage `best-effort`. Unsupported stack ⇒ improvise from closest Base Script, coverage `best-effort`.
- Update mode: rule whose evidence vanished ⇒ removed + named in summary; moved ⇒ evidence updated.
- security-audit on stale inventory ⇒ warn + proceed.

**Visual Design**: inventory contract + project/toolkit layouts in [prd.md § Visual](./prd.md#visual).

---

## 2. Data Model

No database. The "data model" is the inventory JSON contract, `schema/inventory.schema.json` (JSON Schema draft 2020-12). Every Base Script emits it; fixtures validate against it; the table renderer and `parse_access_inspector.sh` read only it.

### Creation of New Entities

- **Inventory** (root object, keys in this order):
  - `schema_version`: `"1"`
  - `stack`: string (`django|spring|symfony`, or detected name when improvised)
  - `discovery_mode`: `runtime|static`
  - `coverage`: `complete|best-effort`
  - `coverage_note`: string|null (required non-null when `best-effort`: static reason or "improvised from <stack> Base Script")
  - `base_script`: `{stack: string, version: string}` (toolkit version vendored)
  - `boot_environment`: `{entry: string, stubs: [{target, reason}], pinned: [{setting, value, reason}]}` — `entry` = settings module / Spring profile / Symfony env
  - `project_dimensions`: object `{<dimension>: [values...]}`, may be `{}`
  - `endpoints`: array of **Endpoint**, sorted by (`path`, `method`, `handler`)
- **Endpoint** (keys in this order):
  - `method`: `ANY|DELETE|GET|HEAD|OPTIONS|PATCH|POST|PUT`
  - `path`: string, `^/`, params `{name}`
  - `handler`: string (`path:line` or dotted name)
  - `authentication`: `{value: anonymous|optional|required|unknown, layer: global|class|method|framework-default|null, raw: string|null, rule: string|null}`
  - `authorization`: `{value: none|rule|unknown, layer: same enum|null, raw: string|null, rule: string|null}` — on both axes, `rule` = `builtin:<name>` or `recognition:<name>` that produced the value
  - `dimensions`: object `{<dimension>: value}`; keys must equal `project_dimensions` keys, values ∈ declared list
  - `unknown_reason`: string|null; non-null ⇒ Acknowledged Unknown
- **Serialisation rule** (identical in Python/Java/PHP; reference bytes: `schema/samples/canonical.json`): UTF-8, `\n`, 2-space indent; each root key on its own line with its value compact; `endpoints` one compact object per line at 4-space indent, `"endpoints": []` when empty; compact = separators `", "` and `": "`, non-ASCII unescaped, `/` unescaped; keys in schema order (`project_dimensions` keys and value lists in declared order); endpoints sorted by (`path`, `method`, `handler`) by code point; no trailing whitespace; file ends with `\n`.

### Modification of Existing Entities

- security-audit skill: `references/django-access-inspector.md` + `scripts/parse_django_access_inspector.sh` removed, replaced by `references/access-inspector.md` + `scripts/parse_access_inspector.sh` (UF6).

### Relationships

- 1 Inventory ↔ 1 Adapted Script ↔ 1 bootable app. `endpoints[].dimensions` keys ⊆ `project_dimensions` keys (schema-enforced via `additionalProperties`-free check in script, not expressible in JSON Schema alone → runtime check in each Base Script).
- `authorization.rule` names a rule in `rules.py` (Django) / `Rules.java` / `rules.php`; `unknown_reason` names an Acknowledged Unknown in the same file.

---
## 3. Architecture

Legend: 🟢 new · ⚪ salvaged from a sibling repo (path given) · 🔵 modified existing file. Everything in this repo is 🟢 (repo holds only docs today).

### Toolkit root

#### A. `schema/inventory.schema.json` 🟢
**Purpose**: the single shared contract (§2).
**Changes**: JSON Schema 2020-12; enums for method/values/layers; `required` lists; `additionalProperties: false` everywhere; `if coverage == best-effort then coverage_note: string`.
**Why**: every Base Script, fixture test and the parse script depend on it; written first.

#### B. `Makefile` 🟢, `.github/workflows/ci.yml` 🟢
**Changes**: targets `test-django` (uv + pytest), `test-spring` (`./mvnw` in fixture), `test-symfony` (composer + phpunit), `test` = all three, `lint`. CI: one job per stack, each installs only its toolchain.
**Why**: per-stack toolchain decision.

### Django Base Script — `base-scripts/django/` (vendored as `tools/access-inspector/` in projects)

Stdlib only + the project's Django/DRF. Python ≥ 3.10. Each file is a template the Agent edits only where marked `# --- project ---`.

#### C. `inspect.py` 🟢
**Changes**: argparse `--check | --table | --unknowns`; flow `boot.boot()` → `discovery.endpoints()` → `classify.classify(ep)` per endpoint → `dimensions.assign(ep)` → `inventory.validate()` → `inventory.write()` / `inventory.check()` / `table.render()`. `--unknowns` prints JSON lines of endpoints with any `unknown` (handler, raw, method, path) for the Agent loop. Exit codes: 0 ok, 1 check diff, 2 boot/validation error (no file written).
**Why**: UF1/UF2 entrypoint; `--unknowns` is the Agent's interface in UF3/UF5.

#### D. `boot.py` 🟢
**Changes**: `ENTRY = "config.settings.production"`, `STUBS = [Stub(target="config.secrets.load", replacement=..., reason=...)]`, `PINNED = [Pin("DEBUG", False, reason)]`; `boot()`: insert project root in `sys.path`, set `DJANGO_SETTINGS_MODULE`, apply stubs via `unittest.mock.patch` before `django.setup()`, apply pins via `settings` override, return `BootEnvironment` for the inventory header.
**Why**: pinned Boot Environment; stub targets are dotted names so a reviewer sees what was replaced.

#### E. `discovery.py` ⚪ from `django-access-inspector/django_access_inspector/services/url_analyzer.py`
**Changes**: keep recursive walk (URLPattern/URLResolver/namespaces/locale resolvers/`_get_callback`); drop debug logger, `CommandError`, URL-name keying; yield `RawEndpoint(callback, pattern_parts: list[str], namespace)`; unknown pattern object → `RawEndpoint` with `unknown_reason="unrecognised urlpattern object <type>"` instead of `TypeError`.
**Why**: completeness rule — never drop, never raise on an exotic pattern.

#### F. `paths.py` 🟢
**Changes**: `normalize(parts) -> str`: join, convert `path()` converters `<int:pk>` → `{pk}`, `re_path` named groups `(?P<pk>...)` → `{pk}`, unnamed groups → `{param}`, strip `^`/`$`, ensure leading `/`, keep trailing slash as declared.
**Why**: path format decision.

#### G. `classify.py` 🟢
**Changes**: resolve the callable: `model_admin` → admin; `.cls` (ViewSet/APIView via `as_view`) → read `actions` map for method→action, per-action `permission_classes`/`authentication_classes` from `@action` kwargs or `get_permissions()` when overridden (call with a stub request, catch → unknown); `.view_class` (CBV) → MRO mixins + `http_method_names`; plain function → `__wrapped__` chain for `login_required`/`permission_required`/`user_passes_test` (identity by function object, not name substring); explicit-vs-default detection via `cls.__dict__` vs DRF `api_settings` → layer `class` vs `framework-default`. Methods: DRF `allowed_methods`/actions, CBV `http_method_names` ∩ defined handlers, function view → `ANY` unless `@require_http_methods`. Handler: `inspect.getsourcefile` relative to project root + `getsourcelines` line; outside project root → dotted `module.qualname`. Output `Classified(endpoint, authn, authz)` using `rules.apply`.
**Why**: fixes the four classification defects found in the old tool (name-keyed, class-level-only, `AllowAny` = authenticated, substring greps).

#### H. `rules.py` 🟢
**Changes**: `BUILTIN: dict[object, Outcome]` keyed by DRF/Django classes and decorators (table from UF1 / PRD mapping; `IsAuthenticatedOrReadOnly` = per-method); `RECOGNITION: list[Rule]` template with `Rule(match=<class or callable or path-prefix predicate>, authn=..., authz=..., layer=..., evidence="orders/permissions.py:12", name="IsOrderOwner")`; `ACKNOWLEDGED: list[Ack(handler_or_path, reason)]`; `apply(classified_inputs) -> Outcome` precedence: method > class > global > framework-default; unmatched custom permission ⇒ `unknown`.
**Why**: built-in vs recognition distinction; evidence lives next to the claim.

#### I. `dimensions.py` 🟢
**Changes**: `DIMENSIONS = {"access_tier": ["public","customer","staff"]}`; `RULES = [(predicate, dimension, value)]` ordered, most specific path first; `assign(ep)` raises `MissingDimension(ep)` when no rule matches.
**Why**: UF4; missing value = failure.

#### J. `inventory.py` 🟢
**Changes**: dataclasses mirroring §2; `to_canonical_json()` implementing the serialisation rule (key order from a constant, sort key `(path, method)`); `validate()` runtime checks JSON Schema cannot (dimension keys, `coverage_note`); `check(committed_path)` → structural diff: added/removed by identity triple, changed by field; renders one line per endpoint.
**Why**: byte stability and `--check` in one place; same logic mirrored in Java/PHP.

#### K. `table.py` 🟢
**Changes**: stdlib fixed-width table: method, path, authn, authz, layer, dimensions, `?` marker on unknown. Never writes files.

#### L. `VERSION` 🟢 — toolkit version copied into `base_script.version`.

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

#### T. `tools/access-inspector/inspect.php` 🟢 — argv `--check|--table|--unknowns`; `require vendor/autoload.php`; `boot.php`; same flow.

#### U. `boot.php` 🟢 — `ENV='prod'`, `DEBUG=false`, stubs via env overrides / `$_SERVER`, pinned list; instantiates `App\Kernel`, `boot()`, returns container.

#### V. `config/packages/access_inspector.yaml` 🟢 (dropped into the project)
**Changes**: `services: { access_inspector.access_map: {alias: security.access_map, public: true}, access_inspector.firewall_map: {alias: security.firewall.map, public: true} }`.
**Why**: only way to reach resolved `access_control` without a test container; owned by the Adapted Script.

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

#### AE. `fixtures/symfony-demo/` 🟢 — latest Symfony skeleton (7.x) + security bundle + latest API Platform (4.x) + API Platform resource (resource-level security, one operation override), controllers with/without attributes, `access_control` rules, `denyAccessUnlessGranted` call, a firewall with `security: false`. Golden + vendored script.

### Agent skill

#### AF. `SKILL.md` 🟢
**Changes**: workflow: (1) detect stack (`manage.py`/`pyproject` django dep; `pom.xml`/`build.gradle` + spring-boot; `composer.json` symfony/framework-bundle) → else closest-stack rule (`references/unsupported.md`); (2) existing `tools/access-inspector/` ⇒ update mode; (3) copy `base-scripts/<stack>/`; (4) boot: find production entry, run, on failure read traceback, stub per toward-production rule, record in `boot.*`; (5) loop: `--unknowns` → for each, read handler/construct source → Recognition Rule with evidence or Acknowledged Unknown; ask user only when source does not settle it; rerun until `--unknowns` empty; (6) dimensions: propose from prefixes/middleware/roles → AskUserQuestion confirm/rename/reject → write; (7) `inspect --table` for the user, write inventory, pick `assets/ci-snippets/<ci>.yml`; (8) `git checkout -b access-inspector/fit`, commit, print summary from `assets/summary-template.md`. Hard rules list (never edit pipeline, never stub settings module, never claim complete when improvised, never remove core fields).

#### AG. `references/django.md`, `references/spring.md`, `references/symfony.md`, `references/unsupported.md` 🟢
**Changes**: per stack: where authn/authz lives by layer, how to find the production entry, common boot failures and their toward-production stubs, built-in rule table, known blind spots. `unsupported.md`: closest-stack table (FastAPI/Flask→django; Micronaut/Quarkus→spring; Laravel→symfony), route-registry hints per framework.

#### AH. `assets/ci-snippets/{github-actions,gitlab-ci,generic}.yml` 🟢, `assets/summary-template.md` 🟢.

### security-audit skill (sibling repo `../skills/security-audit`)

#### AI. `references/access-inspector.md` 🟢, `scripts/parse_access_inspector.sh` 🟢
**Changes**: reference: locate `**/tools/access-inspector/inventory.json`, never boot, run `--check` only to detect staleness (warn), one section per inventory. Parse script (jq): `=== ACCESS INSPECTOR SUMMARY ===` (mode, coverage, counts by authn/authz/layer/dimension), `=== ANONYMOUS ===`, `=== OPTIONAL WITHOUT RULE ===`, `=== UNKNOWN (unexplained) ===`, `=== ACKNOWLEDGED UNKNOWN ===` JSON lines.

#### AJ. `references/django-access-inspector.md` 🔵 removed, `scripts/parse_django_access_inspector.sh` 🔵 removed, `references/scan.md` 🔵 lists `access-inspector.md`, `SKILL.md` 🔵 step 4 parse list updated.

---
## 4. Test Plan

Principle (PRD): golden-file tests are the test of a Base Script; no unit tests on internals except where a pure function is shared by three languages (serialisation, path normalisation, check diff). Fixture = the spec.

### Unit Tests

Django (`base-scripts/django/tests/`, pytest, no Django boot):
- `test_paths_normalize`: `path("api/<int:pk>/")` → `/api/{pk}/`; `re_path(r"^items/(?P<slug>[\w-]+)$")` → `/items/{slug}`; unnamed group → `{param}`; nested prefixes joined; trailing slash preserved; leading slash added.
- `test_inventory_canonical_bytes`: a hand-built inventory serialises to the committed `schema/samples/canonical.json` byte for byte (key order, one endpoint per line, sort by path then method, `\n` terminated, unicode unescaped).
- `test_inventory_sort`: `/a` `POST` before `/a/b` `GET`; `ANY` sorts before `DELETE`.
- `test_inventory_validate_dimension_keys`: endpoint with dimension key not declared → `ValidationError` naming endpoint.
- `test_inventory_validate_coverage_note`: `best-effort` with `coverage_note: null` → error.
- `test_check_diff`: committed vs current with one added, one removed, one authn change → diff lines `+ GET /x`, `- POST /y`, `~ GET /z authentication.value required→optional`; exit 1; identical → exit 0; no committed file → exit 2 with hint.
- `test_rules_precedence`: method outcome beats class beats global beats framework-default; custom permission with no rule → `unknown`; `IsAuthenticatedOrReadOnly` GET → `optional`, POST → `required`.
- `test_dimensions_assign_missing`: no matching rule → `MissingDimension` naming the endpoint; two matching → first (most specific) wins.
- `test_boot_stub_rules`: a `Stub` whose target is a settings module path → `BootError("settings module may not be stubbed")`; `Pin("DEBUG", True)` → `BootError("pin must move toward production")` (allow-list: `DEBUG=False`, `ALLOWED_HOSTS`, flags listed with reason).

Spring (`base-scripts/spring/src/test/java/accessinspector/` plain JUnit, no context):
- `InventoryCanonicalTest`: same `schema/samples/canonical.json` byte for byte via Jackson writer.
- `CheckDiffTest`: same three-way diff as Django.
- `RulesPrecedenceTest`: builtin SpEL set classification; `@bean.call()` → `unknown`; `@RolesAllowed({"USER","ADMIN"})` raw = both.

Symfony (`base-scripts/symfony/tests/`, PHPUnit, no kernel):
- `InventoryCanonicalTest`, `CheckDiffTest`, `RulesPrecedenceTest`: mirrors. Attribute parsing: `#[IsGranted('ROLE_ADMIN')]` → `required` + `rule`; expression attribute → `unknown`.

Cross-language:
- `schema/samples/canonical.json` + `schema/samples/canonical.input.json` (neutral input): the three `InventoryCanonicalTest`s consume the same input and must produce the same bytes. Any divergence fails exactly one language's test, pointing at its serialiser.
- `test_schema_samples_valid` (Python, `jsonschema`): every `fixtures/*/expected/inventory.json` and `schema/samples/canonical.json` validate; a mutated sample with `authentication.value: "sso"` fails.

### Integration Tests

Golden files (one per fixture; run the vendored `tools/access-inspector/` inside the fixture, compare bytes with `expected/inventory.json`):
- `test_django_golden` (`fixtures/django-demo`): asserts, through the golden file, the UF1 acceptance list: unnamed view present; duplicate-name views both present; `IsAuthenticatedOrReadOnly` split per method; `@action(permission_classes=)` and `get_permissions()` override reflected at layer `method`; admin endpoints `required`/`global`/`is_staff`; `i18n_patterns` → one endpoint per language; `@require_http_methods(["POST"])` → single `POST`; function view without restriction → `ANY`; custom `IsOwner` → `unknown` + `unknown_reason` from the fixture's Acknowledged Unknown; `TenantMiddleware` Recognition Rule → `/api/*` authentication `required` layer `global`, `rule: recognition:tenant_middleware`; `/graphql/` authorization `unknown` with reason; dimension `access_tier` on every endpoint; explicit `permission_classes` → layer `class`, inherited DRF default → `framework-default`.
- `test_django_check_clean`: `--check` on the fixture → exit 0, no write.
- `test_django_check_drift`: copy fixture, change `IsAdminUser` → `AllowAny` on one view → exit 1, diff shows `~ ... authorization.value rule→none` and `authentication.value required→optional`; `inventory.json` untouched.
- `test_django_check_missing_dimension`: add a view under a prefix no dimension rule covers → exit 2 naming the endpoint.
- `test_django_boot_failure`: fixture settings pointing to a missing secrets module without stub → exit 2, stderr contains import error and `ENTRY`; no `inventory.json` written.
- `test_django_unknowns_output`: `--unknowns` → JSON lines containing exactly the `/graphql/` and `IsOwner` endpoints.
- `test_django_table_no_write`: `--table` prints ≥ 1 row per endpoint, mtime of `inventory.json` unchanged.
- `test_django_determinism`: run twice, byte-equal; run from another cwd, byte-equal.
- `test_spring_golden` (`fixtures/spring-demo`, `./mvnw test` in fixture): `permitAll` matcher → `anonymous`/`global`; `anyRequest().authenticated()` → `required`; second chain via `securityMatcher` → raw names that chain; `@PreAuthorize("hasRole('ADMIN')")` → `rule`/`method`; interface mapping → implementing class handler; `/actuator/health`, `/error` present; `@RolesAllowed` raw lists both; `@permissionEvaluator` → `unknown`; `@RequestMapping` without method → `ANY`.
- `test_spring_check_drift`: same shape as Django via `inspect.sh --check` after editing one matcher.
- `test_spring_gradle_smoke` (`fixtures/spring-gradle-smoke`): `inspect.sh` picks `gradlew`, writes an inventory with the 2 expected endpoints.
- `test_symfony_golden` (`fixtures/symfony-demo`, `vendor/bin/phpunit`): `access_control` `^/admin` → `required`+`rule`/`global`; firewall `security: false` → `anonymous`/`global`; `#[IsGranted]` → `rule`/`method`; API Platform resource-level security inherited by operations, override on one operation; `denyAccessUnlessGranted` → `unknown` + reason; `api_doc`/`api_entrypoint` ordinary endpoints; route without methods → `ANY`; metadata factory removed → API Platform endpoints `unknown` with reason, exit 0.
- `test_symfony_check_drift`: mirror.
- `test_parse_access_inspector` (`../skills/security-audit`, bash + jq on `fixtures/django-demo/expected/inventory.json`): summary counts match; `=== ANONYMOUS ===` lists expected paths; acknowledged vs unexplained separated.

Agent (not automated in v1, PRD decision): acceptance = first real Django project fitted and merged. Manual checklist in `assets/summary-template.md` (every rule has evidence that exists, `--unknowns` empty, `--check` green, no pipeline file touched, branch created).

---
## 5. To Do List

Phases follow the UF slicing. Phase 0 is the contract every UF depends on. Phases 1–3 (Django) deliver the first milestone; 4–6 can run in parallel after it.

### Phase 0 — Contract (prerequisite for all UFs)

- [x] **Write the schema**
  - File: `schema/inventory.schema.json`
  - Encode §2 exactly: enums, key `required` lists, `additionalProperties: false`, `if/then` for `coverage_note`.
- [x] **Write the canonical samples**
  - Files: `schema/samples/canonical.input.json`, `schema/samples/canonical.json`
  - Neutral 6-endpoint input (incl. `ANY`, unicode path, two methods on one path, one unknown, one dimension) and its byte-exact canonical form, hand-verified once.
- [x] **Repo tooling**
  - Files: `Makefile`, `.github/workflows/ci.yml`, `base-scripts/django/pyproject.toml` (uv, ruff, mypy strict, pytest, jsonschema dev-only), `VERSION`
  - Copy conventions from `django-access-inspector/pyproject.toml` + `Makefile`.
- [x] **Write tests**
  - File: `base-scripts/django/tests/test_schema.py`
  - Test: `test_schema_samples_valid` — samples validate; mutated `authentication.value: "sso"` fails.
- [x] **Verify**: `make test-django` green with only schema tests.

### Phase 1 — UF1 Inventory a Django project

- [ ] **Inventory model + canonical writer + validate**
  - File: `base-scripts/django/inventory.py`
  - Dataclasses per §2; `to_canonical_json`; `validate` (dimension keys, coverage note); sort `(path, method)`.
- [ ] **Path normalisation**
  - File: `base-scripts/django/paths.py`
- [ ] **Discovery**
  - File: `base-scripts/django/discovery.py` (⚪ from `url_analyzer.py`)
  - Yield `RawEndpoint`; exotic pattern → unknown reason, never raise.
- [ ] **Built-in rules + rule engine**
  - File: `base-scripts/django/rules.py`
  - `BUILTIN` table (PRD mapping), precedence, `RECOGNITION=[]`, `ACKNOWLEDGED=[]` templates with commented example.
- [ ] **Classifier**
  - File: `base-scripts/django/classify.py`
  - Admin / ViewSet+actions / APIView / CBV / function; explicit-vs-default layer; handler location; HTTP methods incl. `ANY`.
- [ ] **Boot template**
  - File: `base-scripts/django/boot.py`
  - `ENTRY`, `STUBS`, `PINNED`, guard rules (no settings-module stub, pins toward production only).
- [ ] **Dimensions template**
  - File: `base-scripts/django/dimensions.py`
  - `DIMENSIONS={}` default → no `dimensions` field; `assign` raises on miss.
- [ ] **Entrypoint + table**
  - Files: `base-scripts/django/inspect.py`, `base-scripts/django/table.py`
  - `--table`, `--unknowns`; exit codes 0/2.
- [ ] **Django fixture**
  - Dir: `fixtures/django-demo/` (⚪ seed `demo_views/`, `settings.py`)
  - Add every construct listed in §3 AB; vendored `tools/access-inspector/` with one Recognition Rule (`TenantMiddleware`), one Acknowledged Unknown (`IsOwner`), `/graphql/` ack, dimension `access_tier`; produce `expected/inventory.json`, review it by hand once.
- [ ] **Write tests**
  - Files: `base-scripts/django/tests/test_paths.py`, `test_inventory.py`, `test_rules.py`, `test_dimensions.py`, `test_boot.py`, `fixtures/django-demo/tests/test_golden.py`
  - Tests: `test_paths_normalize`, `test_inventory_canonical_bytes`, `test_inventory_sort`, `test_inventory_validate_*`, `test_rules_precedence`, `test_dimensions_assign_missing`, `test_boot_stub_rules`, `test_django_golden`, `test_django_unknowns_output`, `test_django_table_no_write`, `test_django_determinism`, `test_django_boot_failure`, `test_django_check_missing_dimension`.
- [ ] **Verify**: `make test-django` green; `expected/inventory.json` reviewed line by line against UF1 acceptance list.

### Phase 2 — UF2 Enforce the inventory in CI

- [ ] **Check diff**
  - File: `base-scripts/django/inventory.py` (`check`), `inspect.py` (`--check`, exit 1, never writes)
- [ ] **CI snippets**
  - Files: `assets/ci-snippets/github-actions.yml`, `gitlab-ci.yml`, `generic.sh`
  - Install project deps only, run `python tools/access-inspector/inspect.py --check`.
- [ ] **Write tests**
  - Files: `base-scripts/django/tests/test_check.py`, `fixtures/django-demo/tests/test_golden.py`
  - Tests: `test_check_diff`, `test_django_check_clean`, `test_django_check_drift`.
- [ ] **Verify**: drift test diff output matches UF2 wording (added/removed/changed + hint).

### Phase 3 — UF3 Fit a Django project with the Agent (+ UF4 dimensions, UF5 update) — first milestone

- [ ] **Skill workflow**
  - File: `SKILL.md`
  - Steps 1–8 of §3 AF; hard rules; update-mode branch (UF5): detect existing dir, diff rules' evidence against current tree, remove/relocate, run `--unknowns` only; optional Base Script refresh keeping `boot.py`/`rules.py`/`dimensions.py`.
- [ ] **Django reference**
  - File: `references/django.md`
  - Production entry heuristics (`config/settings/production.py`, `DJANGO_SETTINGS_MODULE` in Dockerfile/Procfile), boot failure → stub cookbook, built-in rule table, blind spots.
- [ ] **Dimension proposal (UF4)**
  - File: `SKILL.md` step 6 + `references/django.md` section "candidate dimensions" (prefix groups, middleware, admin, roles seen in rules) → AskUserQuestion confirm/rename/reject → write `dimensions.py`.
- [ ] **Summary template + commit**
  - File: `assets/summary-template.md`; branch name follows the project's convention (inferred from recent branch names, e.g. `feat/...`, `chore/...`; fallback `access-inspector/fit`), commit message lists rules/unknowns/boot decisions.
- [ ] **Verify (manual, milestone)**: fit `~/Theodo/perenco/action-tracking`; checklist: branch exists, `--unknowns` empty, `--check` green, every evidence `file:line` exists, no pipeline file in the diff, dimensions confirmed by the user. Then re-run in update mode on the same project → no diff.

### Phase 4 — UF6 Audit from the Committed Inventory (sibling repo `../skills/security-audit`)

- [ ] **Reference + parse script**
  - Files: `references/access-inspector.md`, `scripts/parse_access_inspector.sh`
- [ ] **Retire Django-specific scanner**
  - Files: delete `references/django-access-inspector.md`, `scripts/parse_django_access_inspector.sh`; update `references/scan.md`, `SKILL.md` step 4.
  - Staleness: run `--check` if the Adapted Script is runnable, else skip; on exit 1 → "stale" banner in report; never regenerate.
- [ ] **Write tests**
  - File: `../skills/security-audit/scripts/tests/test_parse_access_inspector.sh` (bats or plain bash) on `fixtures/django-demo/expected/inventory.json`.
- [ ] **Verify**: run the security-audit skill on `fixtures/django-demo` → report has mode/coverage header, anonymous list, acknowledged vs unexplained sections.

### Phase 5 — UF7 Inventory a Spring project

- [ ] **Runner + boot + discovery**
  - Files: `base-scripts/spring/tools/access-inspector/inspect.sh`, `src/test/java/accessinspector/{AccessInspectorRun,Boot,Discovery}.java`
- [ ] **Filter chain + method security + rules**
  - Files: `FilterChainResolver.java`, `MethodSecurity.java`, `Rules.java`
- [ ] **Inventory + check + table + dimensions**
  - Files: `Inventory.java`, `Dimensions.java`, `Table.java`
- [ ] **Fixtures**
  - Dirs: `fixtures/spring-demo/` (⚪ seed `sample/microservice-example`, add §3 AC constructs), `fixtures/spring-gradle-smoke/`
- [ ] **Reference**: `references/spring.md` (profile heuristics, `@MockBean` stub cookbook, filter-chain internals note + Spring Security version tested).
- [ ] **Write tests**: `InventoryCanonicalTest`, `CheckDiffTest`, `RulesPrecedenceTest`, golden via `./mvnw test` in fixture, `test_spring_check_drift`, `test_spring_gradle_smoke` (driven from `Makefile`).
- [ ] **Verify**: `make test-spring` green; reflection access to authorization mappings guarded: on failure → every endpoint global layer `unknown` with reason "Spring Security internals changed", not a crash.

### Phase 6 — UF8 Inventory a Symfony project

- [ ] **Entry + boot + dropped config**
  - Files: `base-scripts/symfony/tools/access-inspector/inspect.php`, `boot.php`, `config/packages/access_inspector.yaml`
- [ ] **Discovery + access control + attributes + API Platform**
  - Files: `src/Discovery.php` (⚪), `AccessControlResolver.php`, `Attributes.php`, `ApiPlatform.php` (⚪), `Rules.php`
- [ ] **Inventory + check + table + dimensions**: `Inventory.php`, `Dimensions.php`, `Table.php`
- [ ] **Fixture**: `fixtures/symfony-demo/` per §3 AE (latest Symfony 7.x, API Platform 4.x; Spring fixture on latest Spring Boot 3.x).
- [ ] **Reference**: `references/symfony.md`.
- [ ] **Write tests**: PHPUnit mirrors + golden + `test_symfony_check_drift` + metadata-factory-absent case.
- [ ] **Verify**: `make test-symfony` green.

### Phase 7 — UF9 Fit an unsupported stack

- [ ] **Closest-stack reference**
  - File: `references/unsupported.md`
  - Table framework → Base Script; route-registry hints (FastAPI `app.routes`, Flask `app.url_map`, Express `app._router.stack`, Laravel `Route::getRoutes()`); mandatory `coverage: best-effort` + note.
- [ ] **Skill branch**: `SKILL.md` step 1 fallback; refuse when no registry and no recognisable routing.
- [ ] **Verify (manual)**: fit a small FastAPI sample; inventory validates, `best-effort`, `--check` green.

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

### security-audit skill (`../skills/security-audit`)
- Current behavior: SKILL.md orchestrates one subagent per scanner reference (`references/*.md`), parses JSON via `scripts/parse_*.sh` (jq, summary section + JSON lines), baseline file, report template.
- Current limitations: Django-specific access scanner only (`references/django-access-inspector.md`), must boot the app via `manage.py`; no notion of coverage/mode.

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

---

## 7. Reference Implementations

- **Recursive urlpatterns walk** — `../django-access-inspector/django_access_inspector/services/url_analyzer.py` `UrlAnalyzerService.extract_views_from_urlpatterns`: URLPattern/URLResolver/namespace/`LocaleRegexURLResolver` handling; reuse structure, replace `TypeError` with unknown endpoint, keep `pattern` parts.
- **Callback shape detection** — `../django-access-inspector/django_access_inspector/services/view_inspector.py`: the `model_admin` / `view_class` / `cls` / `initkwargs` branch order is right; everything after it (name substrings, source greps, "any class = authenticated") is what §3 G replaces. Also shows `get_default_classes` reading `REST_FRAMEWORK` settings.
- **Fixture breadth** — `../django-access-inspector/demo_views/views.py`, `django_native_views.py`, `urls.py`: decorator vs attribute vs `@action` override, Django decorators/mixins, DRF router registration; extend per §3 AB.
- **Python tooling** — `../django-access-inspector/pyproject.toml` (uv, ruff, mypy strict with django-stubs, pytest-django, coverage gate) and `Makefile` (`validate` = lint+typecheck+test).
- **Router iteration + API Platform metadata** — `../accent/src/AccessControl/AccentReportFactory.php` (route collection loop), `RouteAccessControlFactory.php` (`_api_resource_class` / `_api_operation_name` → `ResourceMetadataCollectionFactoryInterface` → `getOperation()->getSecurity()`, exception handling for missing resource/operation).
- **Spring sample controllers** — `../spring-access-inspector/sample/microservice-example/src/main/java/com/theodo/ms/controller/{Cars,Another,Houses,Trees}Controller.java`: `@RolesAllowed`, `@Secured`, `@PreAuthorize` with `isAuthenticated()`/`permitAll()`, class-level `@PreAuthorize`; seed for the Spring fixture.
- **Scanner reference + parse script pattern** — `../skills/security-audit/references/semgrep.md` + `scripts/parse_semgrep.sh`: sections `=== X SUMMARY ===` then JSON lines; `jq -c` per finding; `set -euo pipefail`, jq presence check; replicate for `parse_access_inspector.sh`.
- **Skill structure** — `../skills/security-audit/SKILL.md`: numbered workflow, `references/` discovery, `assets/` templates, AskUserQuestion at decision points; model for `SKILL.md` here.

---

## Notes

- Phases 1–3 are the first milestone; do not start 5–7 before a real Django project is fitted, the contract will move.
- Spring filter-chain reflection: record the Spring Security version tested in `references/spring.md`; guard with the "internals changed ⇒ unknown" fallback.
- `.claude/skills/` is APM-generated; keep untracked unless decided otherwise.

## Unresolved questions

1. Toolkit distribution of the skill to users: APM dependency on this repo, or copy into `../skills`? (Affects where `references/` paths resolve in `SKILL.md`; needed before Phase 3.)

## Resolved during planning

- Milestone target: `~/Theodo/perenco/action-tracking`.
- Spring handlers: dotted names without lines, for all handlers.
- Fixtures on latest framework versions (Spring Boot 3.x, Symfony 7.x, API Platform 4.x).
- Kotlin controller in the Spring fixture: deferred.
- Agent branch naming: project convention, inferred from recent branches.
