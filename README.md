# All Access Inspector

List every HTTP endpoint your application exposes, with its authentication and authorization, as a committed file that CI keeps up to date. No LLM runs in your pipeline.

An agent skill fits the toolkit to your project **once**. It leaves a small script in `tools/access-inspector/` that boots your app in a production-like environment, reads the framework's real route table, and writes `tools/access-inspector/inventory.json`. From then on, the script regenerates that inventory, and `--check` fails the PR whenever an access-control change is not reflected in it.

```
           once, with the Agent                         every PR, no LLM
┌───────────────────────────────────────┐    ┌──────────────────────────────────┐
│ /all-access-inspector                 │    │ tools/access-inspector/… --check │
│  → vendors the Base Script            │ ─► │  boots the app, reads the routes │
│  → pins the boot, writes rules        │    │  diffs against inventory.json    │
│  → commits tools/access-inspector/    │    │  exit 1 + per-endpoint diff      │
└───────────────────────────────────────┘    └──────────────────────────────────┘
```

- [Supported stacks](#supported-stacks)
- [Install the skill](#install-the-skill)
- [Fit a project](#fit-a-project)
- [Fit an unsupported stack](#fit-an-unsupported-stack)
- [What lands in your repository](#what-lands-in-your-repository)
- [Run the Adapted Script](#run-the-adapted-script)
- [Read the inventory](#read-the-inventory)
- [Look at it in the viewer](#look-at-it-in-the-viewer)
- [Review the inventory](#review-the-inventory)
- [Review app](#review-app)
- [Triage with the Agent](#triage-with-the-agent)
- [Access map](#access-map)
- [Wire it into CI](#wire-it-into-ci)
- [Living with it](#living-with-it)
- [Edit the fitting by hand](#edit-the-fitting-by-hand)
- [Review the fitting](#review-the-fitting)
- [Limits](#limits)
- [Troubleshooting](#troubleshooting)
- [Work on the toolkit](#work-on-the-toolkit)

## Supported stacks

| Stack | Base Script | Discovery | Notes |
|---|---|---|---|
| Django (+ Django REST framework) | `base-scripts/django/` | runtime, URL resolver | Django admin, DRF permissions, `login_required`, mixins, `LoginRequiredMiddleware` |
| NestJS | `base-scripts/nestjs/` | runtime, Express router | Tested on NestJS 11 (CommonJS, jest) and 12 (ESM, vitest), Express adapter; runs through the project's own vitest or jest |
| Spring Boot (Spring MVC + Spring Security) | `base-scripts/spring/` | runtime, `DispatcherServlet` handler mappings | Tested on Spring Boot 4.1 (Spring Security 7), Java 21, Maven 3.9 and Gradle 9; runs as one test through the project's own build. Filter chains, `@PreAuthorize`, `@Secured`, JSR-250 |
| Symfony (+ API Platform) | `base-scripts/symfony/` | runtime, the router | Tested on Symfony 8.1 and API Platform 5.0, PHP 8.5 (needs PHP 8.2 or later). Firewalls, `access_control`, `#[IsGranted]`, `denyAccessUnlessGranted()`, API Platform `security` |
| Anything else (FastAPI, Flask, Express, Laravel, Rails…) | improvised from the closest one | runtime when the framework has a route registry, else static | Always `coverage: best-effort`. See [Fit an unsupported stack](#fit-an-unsupported-stack) |

Base Script version: see [`skills/all-access-inspector/VERSION`](skills/all-access-inspector/VERSION) (currently 0.4.0). Every inventory records the version that produced it.

## Install the skill

The skill is the directory `skills/all-access-inspector/`. It holds `SKILL.md`, the Base Scripts, the stack references, the CI templates and the viewer.

**Claude Code, copied by hand.** Copy the directory into a skills folder, either for you alone or for one project:

```bash
git clone https://github.com/BastienTeissier/all-access-inspector.git
cp -R all-access-inspector/skills/all-access-inspector ~/.claude/skills/           # every project
cp -R all-access-inspector/skills/all-access-inspector <project>/.claude/skills/   # one project
```

`cp -R` keeps the `VERSION` symlinks inside the Base Scripts. They are relative, so they still resolve.

**APM.** The repository is also an APM package (see `apm.yml`, target `claude`). You can install it as a dependency the way your team installs its other skills.

**Requirements on the machine that runs the fitting:**
- the project's own toolchain, installed: its virtualenv / `uv` / `poetry` for Django, its `node_modules` for NestJS, a JDK and the Maven or Gradle build for Spring, `composer install` done for Symfony;
- the project able to import its code. The script boots the app but never serves it, and never needs a database;
- Spring: `spring-boot-starter-test` and Spring Security on the test classpath, and `useJUnitPlatform()` on a Gradle `test` task;
- Symfony: `symfony/framework-bundle`. `access_control` is read only with `symfony/security-bundle`, API Platform operations only with `api-platform/core`, `.env` files only with `symfony/dotenv`. The kernel class must not be `final`, because the script extends it;
- Node 24.2 or later for the review CLI and triage. Nothing to install.

## Fit a project

Open your agent in the project and ask:

```
/all-access-inspector
```

Or in plain words: *"inventory the endpoints of this app with their access control"*, *"fit the access inspector"*, *"resolve the access-inspector unknowns"*.

The Agent follows [`SKILL.md`](skills/all-access-inspector/SKILL.md). Expect a few questions; nothing is guessed.

### 1. Detect the stack

It reads `manage.py` / `pyproject.toml` (Django), `package.json` with `@nestjs/core` (NestJS), `pom.xml` / `build.gradle*` with `spring-boot` (Spring), or `composer.json` with `symfony/framework-bundle` (Symfony), and tells you which Base Script it uses. For any other stack it says no Base Script exists and improvises one ([Fit an unsupported stack](#fit-an-unsupported-stack)). In a monorepo with several bootable apps (several settings packages, Nest apps, Maven or Gradle application modules, Symfony kernels), it asks which ones to fit. Each one gets its own `tools/access-inspector/` in its own app root.

If `tools/access-inspector/` already exists, it switches to [update mode](#update-the-fitting).

### 2. Vendor the Base Script

It copies the Base Script into `tools/access-inspector/`. For Spring, the Java sources go into the project's test sources as `src/test/java/accessinspector/`, so they run on the project's own classpath. That copy, the **Adapted Script**, is yours from now on (see [ADR 0003](docs/adr/0003-adapted-script-is-vendored.md)).

### 3. Pin the Boot Environment

The inventory must describe what **production** serves, not what a developer's laptop serves. The Agent:

- finds the production entry:

  | Stack | Production entry |
  |---|---|
  | Django | the settings module production runs |
  | NestJS | the root module, and the setup function `main.ts` applies |
  | Spring | the application class `main` runs (`@SpringBootTest(classes = …)`), and the production profile (`@ActiveProfiles`) |
  | Symfony | the kernel class (`Boot::KERNEL`), and the `APP_ENV` production runs (`Boot::ENV`); `APP_DEBUG` is always `0` |

- pins every environment variable or property that shapes routes or access to its production value: `ENVIRON` (Django, NestJS), `PINNED` (Spring, through `@DynamicPropertySource`), `Boot::environ()` (Symfony; `.env.local` files never load);
- runs the script, reads the boot error, and stubs only what blocks the boot: secrets, vault clients, databases, caches, brokers.

It **never** stubs what decides routes or access checks: the settings module, a guard, a controller, the root module, a `SecurityFilterChain`, an `AuthorizationManager`, `security.yaml`, a voter, the kernel. A pin may only move a setting *toward* production (`DEBUG=False`, `NODE_ENV=production`). The boot file enforces part of this itself.

**You will be asked** when only the team knows a value, for example a feature flag's production setting. Each boot entry carries a written reason.

### 4. Resolve every unknown

The script emits `unknown` for any construct it cannot read: a custom decorator, a project permission class, a custom guard, an overridden admin site, a SpEL expression calling a project bean (`@permissions.canRead(#id)`), a voter attribute (`#[IsGranted('PROJECT_VIEW')]`). For each one, the Agent reads the source and either:

- writes a **Recognition Rule**: it maps the construct onto the classification and cites **evidence**, the `file:line` of the class or function that implements the check; or
- writes an **Acknowledged Unknown** with a reason a reviewer can verify. Use this when the source cannot settle the question: an ownership check on data, GraphQL per-resolver auth, an external policy engine.

A name alone is never evidence: `IsTenantMember` stays `unknown` until someone reads the class. **You will be asked** when the source leaves the meaning open.

It then reviews middleware, which the script cannot see, and adds a path-prefix rule for any middleware that authenticates a prefix.

### 5. Propose Project Dimensions and expected access

The Agent proposes one or two labels that make sense to your team, typically `access_tier` with `public` / `customer` / `staff`. For each value it shows:
- the assignment rule, e.g. "path starts with `/admin/`";
- the endpoints it covers, with counts;
- an **expected access**: which `authentication` and `authorization` values an endpoint of that zone may have. For example, `staff` → required, rule.

You confirm, rename, merge or reject them with a multiple-choice question. The expectation is derived from what the zone *means*, never from what the endpoints currently get. An endpoint outside its zone is a finding to review, not something to hide by bending the rule.

### 6. Write the inventory and the CI snippet

It writes `inventory.json`, checks that `--check` exits 0, and fills a CI snippet from your existing test job. It **does not edit your pipeline**. It excludes `tools/access-inspector/` from your linters and type checkers (one entry each) and re-runs them.

### 7. Branch, commit, summary

It creates a branch following your naming convention (fallback `access-inspector/fit`) and commits. The commit body lists every boot decision, rule and acknowledged unknown. It **never pushes**. It ends with a summary: endpoint counts by authentication × authorization, boot decisions, rules with their evidence, acknowledged unknowns, zones, endpoints outside their zone, and next steps.

## Fit an unsupported stack

For a stack with no Base Script (FastAPI, Flask, Express, Fastify, Laravel, Micronaut, Rails, ASP.NET Core, Go…), the Agent improvises an Adapted Script from the closest Base Script. It follows [`references/unsupported.md`](skills/all-access-inspector/references/unsupported.md):

1. **It picks the closest Base Script**, by language first, then by routing shape, and says why: a Python framework starts from `django`, a JavaScript one from `nestjs`, a JVM one from `spring`, a PHP one from `symfony`.
2. **It sorts every file of that Base Script into one of three lists:**
   - *kept* byte-identical: the inventory module, the rules engine, dimensions, the table;
   - *extended in place*: the Built-in Rules table gains the framework's own checks, and the entry writes the stack's identity (`stack`, `coverage`, `coverage_note`);
   - *rewritten*: boot, discovery, classify and path conversion.

   Every extended or rewritten file starts with a comment naming the Base Script, its version and what changed.
3. **It reads the framework's route registry at runtime** when there is one, such as `app.routes` (FastAPI), `app.url_map` (Flask), the Express router stack, Laravel's route collection, Rails' routes or ASP.NET Core's `EndpointDataSource`. It falls back to reading the route declarations from source only when nothing can be enumerated at runtime, and says why in `coverage_note`.
4. **It marks the inventory `coverage: best-effort`**, whatever the discovery mode. `stack` is the project's framework, and `base_script.stack` is the Base Script it derives from.

The command-line contract stays the same (`--check`, `--table`, `--unknowns`, exits 0 / 1 / 2), so CI, the viewer and the review CLI work unchanged.

The Agent **stops and commits nothing** when the project has neither a route registry nor recognisable routing in its source. It tells you what it looked for.

In update mode, a refresh replaces only the kept files, carries the extended edits over, and never resets `stack` or `coverage`. Once the toolkit ships a Base Script for the stack, the Agent offers to re-base onto it.

Expect more review work than on a supported stack. Every builtin the Agent adds cites the framework's source or documentation, and the commit names them, so check each one.

## What lands in your repository

**Django and NestJS:**

```
tools/access-inspector/
├── inspect.py | inspect.sh       # entry point: the command you and CI run
├── boot.py    | boot.ts          # project section: ENTRY, ENVIRON, STUBS, PINNED (Django) / CONFIGURE (NestJS)
├── rules.py   | rules.ts         # project section: RECOGNITION, ACKNOWLEDGED, NEUTRAL (NestJS)
├── dimensions.py | dimensions.ts # project section: DIMENSIONS, EXPECTED, RULES
├── classify, discovery, inventory, paths, table …   # Base Script, do not edit
├── run.spec.ts, vitest.config.ts, jest.config.cjs   # NestJS only: run through your test runner
├── VERSION                       # Base Script version
├── inventory.json                # the Committed Inventory
└── ci-snippet.yml | .sh          # proposed CI job, for you to wire in
```

**Spring** vendors in two places: the Java sources run as a test on your classpath, and the shell entry runs that test through your build.

```
src/test/java/accessinspector/
├── Boot.java          # project section: @SpringBootTest(classes = …), @ActiveProfiles, PINNED, @MockitoBean stubs
├── Rules.java         # project section: RECOGNITION, ACKNOWLEDGED
├── Dimensions.java    # project section: DIMENSIONS, EXPECTED, RULES
└── AccessInspectorRun.java, Discovery, Inventory …   # Base Script, do not edit
tools/access-inspector/
├── inspect.sh         # runs the one test through mvnw / gradlew; skipped by your own `mvn test`
├── VERSION, inventory.json, ci-snippet.*
```

**Symfony** keeps everything under `tools/access-inspector/`:

```
tools/access-inspector/
├── inspect.php        # entry point
├── src/Boot.php       # project section: KERNEL, ENV, environ()
├── src/Rules.php      # project section: recognition(), acknowledged()
├── src/Dimensions.php # project section: DIMENSIONS, expected(), rules()
├── src/…              # Base Script, do not edit
├── VERSION, inventory.json, ci-snippet.*
```

The Symfony script boots a subclass of your kernel that builds its container in a temporary directory, so `var/cache/` and `config/` are never touched.

Plus one exclusion line per linter or type checker. Nothing else outside `tools/access-inspector/` changes, until you ask for the [access map](#access-map), which lands in `tools/access-map/`.

Only the blocks between `# --- project ---` and `# --- end project ---` (`// --- project ---` in TypeScript, Java and PHP) are project-specific. Everything else stays byte-identical to the Base Script, so a later refresh can replace it.

## Run the Adapted Script

Run from the app root: the directory that holds `manage.py` (Django), the app's `package.json` (NestJS), the application module's `pom.xml` / `build.gradle*` (Spring; in a multi-module build, the module with the application class, not the root), or `composer.json` and `src/Kernel.php` (Symfony).

| Stack | Command |
|---|---|
| Django | `<run> python tools/access-inspector/inspect.py [option]`, with `<run>` = how the project runs Python (`uv run`, `poetry run`, `docker compose run web`, an activated venv) |
| NestJS | `tools/access-inspector/inspect.sh [option]`: it detects vitest or jest from `package.json`, and pnpm / yarn / bun / npm from the nearest lockfile |
| Spring | `tools/access-inspector/inspect.sh [option]`: it runs the test `accessinspector.AccessInspectorRun` through `mvnw` / `gradlew` (app root or a parent), else `mvn` / `gradle` on `PATH`. The build's log shows only when the build stops before the script reports |
| Symfony | `php tools/access-inspector/inspect.php [option]`, on the project's own `vendor/autoload.php` |

| Option | Does | Writes |
|---|---|---|
| *(none)* | Regenerates `tools/access-inspector/inventory.json` | yes |
| `--check` | Compares the code with the committed inventory; prints a per-endpoint diff | no |
| `--table` | Prints a readable table | no |
| `--unknowns` | Prints one JSON line per endpoint whose authentication or authorization is `unknown` | no |

| Exit code | Meaning |
|---|---|
| `0` | OK. With `--check`: `inventory up to date` |
| `1` | `--check` only: the inventory is out of date; the diff is on stdout |
| `2` | No inventory could be produced or read: a boot failure, an invalid rule or dimension, an endpoint no dimension rule assigns, or `inventory.json` missing or corrupt |

```text
$ uv run python tools/access-inspector/inspect.py --table
   METHOD   PATH                 AUTHENTICATION               AUTHORIZATION           HANDLER                                     DIMENSIONS
   ANY      /admin/              required@global              rule@global             django.contrib.admin.sites.AdminSite.index  access_tier=staff
   ANY      /admin/login/        anonymous@framework-default  none@framework-default  django.contrib.admin.sites.AdminSite.login  access_tier=staff
   …

$ tools/access-inspector/inspect.sh --check
~ DELETE /api/admin/users/{id} (AdminController.remove) authorization.value: rule -> none
run `tools/access-inspector/inspect.sh` and commit tools/access-inspector/inventory.json
```

`--check` diff lines:
- `+ METHOD path (handler) authentication=… authorization=…`: a new endpoint;
- `- METHOD path (handler)`: an endpoint removed;
- `~ METHOD path (handler) field: old -> new`: a classification changed;
- `~ key: old -> new`: a header change, e.g. the boot environment, dimensions or expected access.

The output is deterministic: sorted, with no timestamps and no absolute paths. Two runs on the same commit give the same bytes, whoever runs them and wherever.

## Read the inventory

`inventory.json` follows [`schema/inventory.schema.json`](skills/all-access-inspector/schema/inventory.schema.json) (`schema_version` `"1"`). It has a header, then one line per endpoint.

```json
{
  "schema_version": "1",
  "stack": "django",
  "discovery_mode": "runtime",
  "coverage": "complete",
  "coverage_note": null,
  "base_script": {"stack": "django", "version": "0.4.0"},
  "boot_environment": {"entry": "config.settings", "environ": […], "stubs": […], "pinned": […]},
  "project_dimensions": {"access_tier": ["public", "customer", "staff"]},
  "expected_access": {"access_tier": {"staff": {"authentication": ["required"], "authorization": ["rule"]}, …}},
  "endpoints": [
    {"method": "DELETE", "path": "/api/admin/users/{id}", "handler": "AdminController.remove",
     "authentication": {"value": "required", "layer": "global", "raw": "SessionGuard", "rule": "recognition:session", "evidence": "src/auth/session.guard.ts:8"},
     "authorization":  {"value": "rule", "layer": "class", "raw": "RolesGuard roles=[\"admin\"]", "rule": "recognition:roles", "evidence": "src/auth/roles.guard.ts:8"},
     "dimensions": {"access_tier": "staff"}, "unknown_reason": null, "acknowledged": false}
  ]
}
```

### An endpoint

An endpoint is one HTTP **method** (or `ANY` when the handler accepts every method) on one **path** pattern served by one **handler**. It is identified by that triple, never by a route name. Framework routes (admin, health, `HEAD` beside each `GET`) are endpoints too.

### The Core Classification

Every endpoint carries the same closed vocabulary, whatever the stack:

| Axis | Values |
|---|---|
| `authentication` | `anonymous` (anyone), `optional` (anyone, the user is read when present), `required` (a signed-in user), `unknown` |
| `authorization` | `none` (nothing beyond identity), `rule` (a role, permission, group, tenant or ownership check), `unknown` |

An identity check alone (`IsAuthenticated`, `login_required`, a JWT guard) gives authentication `required` and authorization `none`. Authorization is `rule` only when something beyond identity is checked.

Each axis also records:
- `layer`: where the decision is made: `global` (middleware, global guard, admin site, DRF defaults), `class` (controller or view class), `method` (handler), or `framework-default` (nothing set, the framework's default applies);
- `raw`: the framework expression as found (`IsAdminUser`, `AuthGuard('jwt')`, `RolesGuard roles=["admin"]`);
- `rule`: what mapped it: `builtin:<name>` (shipped with the Base Script) or `recognition:<name>` (written for your project);
- `evidence`: `file:line`, set exactly when the rule is a Recognition Rule.

When several checks apply, the strictest wins per axis.

### Unknowns

`unknown` is never silently dropped or guessed. `unknown_reason` says why. `acknowledged: true` means the team accepted it with a written reason (an Acknowledged Unknown). A fitting is complete when every remaining unknown carries a reason.

### Coverage

`runtime` / `complete` means the framework itself reported every route it mounts. `best-effort` (static discovery, or a stack with no Base Script) comes with a `coverage_note`.

## Look at it in the viewer

[`skills/all-access-inspector/viewer/inventory-viewer.html`](skills/all-access-inspector/viewer/inventory-viewer.html) is a single standalone file. Open it in a browser, then pick or drag-and-drop `tools/access-inspector/inventory.json`. The file is read locally and never sent anywhere, and nothing is copied into your project.

- **Overview**: endpoints bucketed by who can reach them, worst first: can't tell, acknowledged, open to anyone, sign-in optional, role required, sign-in required. Each row says in one sentence why it got its bucket.
- **Zones**: endpoints grouped by Project Dimension value, under that value's expected access. An endpoint **outside its zone** is outlined and counted, e.g. a `staff` endpoint that only requires sign-in.
- **Details**: click an endpoint for the chain of layers (request → global → class → method → handler), the check and rule at each layer, and the evidence.

A `HEAD` row identical to its `GET` is shown merged with it.

## Review the inventory

Five hundred endpoints are too many to read one by one. The review CLI keeps track of what you checked and ranks what is left. It needs Node 24.2 or later and nothing else: no install, no build. To review in a browser, see the [Review app](#review-app).

```bash
REVIEW="node <skill>/review/src/cli.ts"
$REVIEW status <project>                     # the Review Queue, worst first
$REVIEW status <project> --json              # one JSON row per queued endpoint
$REVIEW append <project> --verdict safe --reason "Owner-scoped queryset" DELETE '/api/invoices/{pk}/'
$REVIEW append <project> --verdict finding --severity high --ticket https://tracker/SEC-12 --reason "…" ANY /pages/v1/old/
$REVIEW append <project> --verdict accepted --until 2027-01-01 --reason "…" ANY /health/
```

`<project>` is the directory holding `tools/access-inspector/`.

- **Verdicts.** `safe` means you checked it. `accepted` means a known risk, optionally until a date. `finding` needs a severity and can carry a ticket. Only a person gives a Verdict, and `by` is your `git config user.email`. When two handlers serve one method and path, name one with `--handler`. A `GET` Verdict also covers the `HEAD` shown with it.
- **Outdated.** A Verdict on an endpoint inside its expected access goes outdated when its authentication or authorization value changes. Outside it, any change to the check goes outdated: value, layer, raw or rule. Moving the handler within its file keeps the Verdict. A Verdict on an endpoint that is no longer in the inventory is listed as orphaned.
- **The queue.** Every endpoint without a valid `safe` or `accepted` Verdict is in the queue, ranked by its worst tier:
  1. open finding
  2. outdated Verdict
  3. outside its expected access
  4. unknown
  5. sibling inconsistency, where the list and the detail of one resource disagree
  6. anyone can write
  7. an agent Signal
  8. a path parameter with no authorization rule
  9. anyone can read
  10. signed in, no authorization rule
  11. an authorization rule

Verdicts are appended to `tools/access-inspector/reviews.jsonl`, one JSON line per event. The CLI never rewrites the file and never runs git. Commit it with your code. The first `append` also writes `tools/access-inspector/.gitattributes` with `reviews.jsonl merge=union`, so two branches that both review endpoints merge without a conflict. When the same endpoint is reviewed twice, the later Verdict wins.

## Review app

The review app is a local Next.js app for the review CLI's queue: the same tiers, Verdicts and log, with the endpoint's details next to the form. It reads `inventory.json` and `reviews.jsonl`, and it writes only by appending to `reviews.jsonl`, through the same code as `review append`.

### Start it

The app is **not shipped with the skill**: it lives in `apps/review/` of this repository, so it runs from a checkout. You need Node 24.2 or later and pnpm.

```bash
git clone https://github.com/BastienTeissier/all-access-inspector.git
cd all-access-inspector
make install-review                                             # once
node skills/all-access-inspector/review/src/cli.ts app <project>
```

```text
review app: building…                                           # first run, or after the app's sources changed
review app: http://127.0.0.1:4377 (/home/me/shop)
```

- `<project>` is the app root holding `tools/access-inspector/inventory.json`. The app refuses to start without a readable inventory.
- It listens on `127.0.0.1`, on port 4377 or the next free one. A request under any host name other than `127.0.0.1` or `localhost` gets a 403, so a page on another site cannot reach it by DNS rebinding.
- Stop it with Ctrl-C. Run one per project, each on its own port.

### The queue

The header shows the project, its stack, coverage and endpoint count, how many Verdicts are valid, outdated and orphaned, and how many log events you have **not committed** yet.

Below it, the rows are grouped by tier, worst first, with the same 11 tiers as `review status`. Each row shows the method (a `HEAD` identical to its `GET` is merged as `GET,HEAD`), the path, its zone, `authentication/authorization`, its Signals and its Verdict state.

The filters combine, and they live in the URL, so you can bookmark a view:

| Filter | Keeps |
|---|---|
| Zone | one Project Dimension value (shown when the inventory has dimensions) |
| Tier | one tier |
| Signal | rows carrying one Signal: `outside_expected`, `unknown`, `sibling`, `open_write`, `agent`, `id_without_authz`, `open_read` |
| Verdict | `none` (never reviewed) or `outdated` |
| Path | paths containing the text, e.g. `/api/admin/` |
| reviewed | shows the endpoints with a valid Verdict instead of the queue |

### Review one endpoint

Click a row to open its panel:
- **Handler**, with the classification, the tier and the current Verdict. A `file:line` handler or evidence opens in VS Code at that line;
- the **unknown reason**, when the endpoint has one;
- **Authentication** and **Authorization**: value, layer, raw, rule and evidence for each axis;
- **Outdated verdict**: what the reviewer saw beside what the inventory says now, or the date an `accepted` Verdict expired;
- **Signals**: why the row is queued, one line each, including the Agent's triage reason;
- **Siblings**: the other methods of the same resource, such as the list and the detail, with their classification;
- **History**: every event on this endpoint.

Then give a **Verdict**:
- `safe`, `accepted` (optionally with an *until* date) or `finding` (with a severity and, optionally, a ticket URL);
- a reason, always required.

Nothing is written while a field is missing. When the Verdict is saved, the panel moves to the next row of the same tier, so you can work through a tier without going back to the list.

When an unreviewed endpoint shares its path or its handler file with an orphaned Verdict, as a renamed URL does, the form asks **Was it one of these?** **Copy reason** puts the orphan's reason in the form. The orphan itself stays in the log.

### Review many endpoints at once

Filter the queue down to the endpoints that share a judgement, for example every `GET` under `/api/catalog/`, then click **Review selection**. One Verdict and reason go to every endpoint the filters select, written as one batch.

The selection is computed again when you save, from the current files, not from the page you loaded. If it holds an open finding, the app names it and asks you to confirm before replacing it.

### History

**History** in the header lists the log grouped by batch, newest first, a page at a time. Each batch shows its author (your git email, or `agent · <model>` for a triage run), its time, its kinds of events and its count. Below the batches are the **orphaned Verdicts**, whose endpoint is no longer in the inventory.

### Where the data lives

- The files are the truth: `inventory.json` and `reviews.jsonl` in the project. A Verdict's `by` is your `git config user.email`, as with the CLI.
- The app keeps a disposable SQLite cache per project in `~/.cache/all-access-inspector/`. It is rebuilt whenever either file changes, and you can delete it at any time.
- A change to either file, whether a regenerated inventory, a `git pull` or a CLI `append`, shows on the next reload. When a file cannot be read mid-edit, the page shows the last state it could read, with a warning.
- The app never runs git. Commit `reviews.jsonl`, and `.gitattributes` on the first Verdict, with your code. The header's "not committed" count is a reminder.

## Triage with the Agent

The deterministic tiers only see the inventory's facts. Ask the Agent to read the handlers they cannot see into:

```
/all-access-inspector triage the inventory
```

Or: *"triage the access inspector queue"*, *"triage the endpoints under /api/admin/"*.

The Agent:
1. checks that `inventory.json` is committed, and stops otherwise;
2. reads `review status <project> --json` and keeps the rows to triage: no valid human Verdict, not decided by an authorization rule alone, and no agent event still valid for the current classification. You can narrow this to named endpoints or a path prefix;
3. opens each handler and reads it against the stack reference's triage checklist, looking for checks in the body, writes open to anyone, and ownership taken from the request;
4. appends one event per row in a single batch through `review append --agent`:
   - `signal_raised`, with a one-line reason and the `file:line` it read;
   - `triaged`, when it found nothing;
5. prints the Signals it raised and the rows it skipped, with the reason for each.

A Signal moves its row up to tier 7, "suggested by the agent". It **never clears** an endpoint: only a person gives a Verdict. The Agent changes only `reviews.jsonl`, plus `.gitattributes` on the first run. It never edits the inventory or the Adapted Script, and it never commits. Commit those files yourself.

## Access map

The inventory says whether an endpoint checks a sign-in and an authorization. The access map says **who** passes: per Role and per Capability ("Export orders"), whether the role passes, how far its reach goes over the records (its Scope), and where each fact was read (its Basis). Terms are in [`CONTEXT.md` § Access map](CONTEXT.md#access-map).

### Build it with the Agent

Once the inventory is committed:

```
/all-access-inspector build the access map
```

The Agent reads before it writes ([ADR 0005](docs/adr/0005-access-facts-are-read-before-they-are-written.md)):

1. On Django, it vendors the Map Introspect into `tools/access-map/`. The introspect boots the app through the Adapted Script's `boot.py` and reads the admin registry. The Agent then writes **Map Rules** in its project section for the roles, grants, scopes and capabilities your code declares: a groups dict, a sign-in adapter, a `get_queryset` filter. It shows you each one with its `file:line` before saving it. Other stacks have no introspect yet, so every fact is written by hand and the summary lists what could be extracted.
2. It maps each role and each area to your docs: `CONTEXT.md`, else the README or `docs/`. It reports a role the docs name and the code does not, or the reverse. It never writes your `CONTEXT.md`.
3. It writes `tools/access-map/vocabulary.json` with you, only for what no program can read: capability names in your words, capabilities spanning several endpoints, checks inside handler bodies. Each entry gives its reason.
4. It runs `map pin`, `map check` and `map build`, commits on a new branch, and prints the coverage, the partial capabilities left for you to decide, and the "could be extracted" list.

```
tools/access-map/
├── introspect.py, admin.py, runtime.py   # Django Map Introspect, Base Script: do not edit
├── project.py                            # project section: Map Rules
├── runtime.json                          # the Map Runtime: committed, byte-stable, checked in CI
├── vocabulary.json                       # the Map Vocabulary: written with you, every file:line pinned
├── .gitattributes                        # runtime.json -diff linguist-generated
└── out/access-map.html                   # map build output: ignore it in git
```

### Read the map

`node <skill>/map/src/cli.ts build <project>` writes one static page, `tools/access-map/out/access-map.html`, that you can open or share. The review app shows the same map under **Access map**, with a decision form on each cell. Both draw the same data, computed in `map/src/`.

- **Alerts**: partial capabilities with no valid decision, open `finding` decisions, cells not resolved, endpoints behind no capability, the Agent's signals, the review Signals, and endpoints outside their expected access.
- **Roles**: areas × roles. Not signed in is the first column, the superuser the last. Each cell **passes**, is **partial** (the role reaches some of the capability's endpoints), **does not pass**, is **switched off** for everyone, or is **not resolved**. A cell shows its scope, and its basis as a border: solid when read from the code, ≈ inferred, dotted ✎ hand-written, dashed not resolved. Click a cell for its check, its evidence, and the endpoints the role reaches and misses.
- **Routes**: one row per endpoint with who passes and the chain of checks, filterable.
- **How it's built**: what each source contributed, and every heuristic behind an inferred badge.

### Decide a partial capability

A partial cell is either a bug or a leak until a person decides it ([ADR 0006](docs/adr/0006-the-access-map-is-a-view-of-the-review-app.md)). Decide it in the review app's cell panel, or with:

```bash
node <skill>/map/src/cli.ts decide <project> export-orders clerk --verdict accepted --reason "Clerks export through a manager"
```

A Capability Decision uses a Verdict's words and fields (`safe`, `accepted` with `--until`, `finding` with `--severity` and `--ticket`). It is appended to `reviews.jsonl` as a `decided` event that records what the cell was. The decision goes outdated, and the partial comes back under Alerts, when the cell's state or its reached and missed endpoints change. The Agent never decides a cell: asked to look at the map, it appends signals on cells, which show under Alerts.

### Check it in CI

| Command | Exit 1 when |
|---|---|
| `<run> python tools/access-map/introspect.py --check` (Django) | `runtime.json` differs from what the app declares now |
| `node <skill>/map/src/cli.ts check <project>` | a pinned `file:line` no longer shows its line, a vocabulary entry duplicates a Map Rule, the runtime and the inventory disagree, a partial has no valid decision or an outdated one, a term is missing from `CONTEXT.md`, a group role holds no grant |

Both exit 2 when a file is unreadable or invalid. `map check` also prints the coverage and the open findings, which never fail it.

## Wire it into CI

The Agent writes `tools/access-inspector/ci-snippet.yml` (GitHub Actions or GitLab CI) or `ci-snippet.sh` (anything else), filled from your existing test job. Paste it into your pipeline yourself. A GitHub Actions job looks like:

```yaml
access-inspector:
  runs-on: ubuntu-latest
  permissions:
    contents: read
  steps:
    - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
    - uses: astral-sh/setup-uv@…          # your own setup steps
    - name: Install the project
      run: uv sync --locked
    - name: Check the Endpoint Inventory
      run: uv run python tools/access-inspector/inspect.py --check
```

CI needs the same install as your tests: the virtualenv, `node_modules`, the JDK and the build's cache, or `composer install`. It needs no database, no secrets and no LLM. A Spring job runs `tools/access-inspector/inspect.sh --check`; a Symfony job runs `php tools/access-inspector/inspect.php --check` after `composer install`.

## Living with it

### When `--check` fails on a PR

That is the point: an access-control change surfaced. Read the diff, then:

1. **Intended change** (a new endpoint, a guard you added or removed): regenerate and commit the inventory in the same PR.
   ```bash
   uv run python tools/access-inspector/inspect.py   # or tools/access-inspector/inspect.sh
   git add tools/access-inspector/inventory.json
   ```
   The reviewer now sees the access change as a diff line.
2. **Unintended change**: you found a regression before it shipped. Fix the code.
3. **Exit 2 naming an endpoint without a dimension**: a new path no dimension rule covers. Add it to `RULES` in the dimensions file, or ask the Agent.
4. **A new `unknown`**: a new custom construct. Run `--unknowns` and add a rule or an acknowledgement, or ask the Agent: *"resolve the access-inspector unknowns"*.

### Update the fitting

Run `/all-access-inspector` again in a project that already has `tools/access-inspector/`. In update mode the Agent:

- keeps every project-section entry byte for byte, unless it must change;
- re-checks each rule's evidence: it keeps the rule, updates a moved `file:line`, or removes a rule whose construct is gone and says why;
- fixes the boot if it broke, under the same toward-production rule;
- resolves only the **new** unknowns and asks for any new dimension value;
- regenerates, runs `--check`, and commits on a new branch only if something changed.

**Refresh the Base Script** (a newer toolkit version) only when you ask for it: *"refresh the access inspector Base Script"*. The Agent replaces the vendored files and keeps your project sections. It adds any new declaration with its empty default (for example `EXPECTED` when coming from 0.2), regenerates, and lists the endpoints whose classification moved because of the toolkit change.

## Edit the fitting by hand

The Agent writes these blocks, but they are plain code you can edit. Change only the project sections, then regenerate and commit `inventory.json`.

### Boot (`boot.py` / `boot.ts`)

```python
# --- project ---
ENTRY: str | None = "config.settings"                     # the settings module production runs
ENVIRON: list[Env] = [
    Env("SHOP_ENV", "production", reason="production value; mounts no dev-only routes"),
]
STUBS: list[Stub] = [
    Stub("config.secrets.load", reason="secrets vault client is only installed in production",
         replacement=lambda: {"SECRET_KEY": "inventory-stub"}),
]
PINNED: list[Pin] = [Pin("DEBUG", False, reason="production value; settings default to True")]
# --- end project ---
```

```ts
// --- project ---
export const ENTRY: Export = { module: '../../src/app.module.js', export: 'AppModule' };
export const CONFIGURE: Export | null = { module: '../../src/configure-app.js', export: 'configureApp' };
export const ENVIRON: Env[] = [
  { name: 'NODE_ENV', value: 'production', reason: 'production value' },
  { name: 'JWT_SECRET', value: 'inventory-placeholder', reason: 'secret required at boot by src/auth/jwt.strategy.ts' },
];
export const STUBS: Stub[] = [];
// --- end project ---
```

NestJS: `CONFIGURE` must be an exported function that applies what `main.ts` applies before `listen` (global prefix, versioning, `useGlobalGuards`, `app.use`). If `main.ts` does that inline, extract it. Never copy it into `boot.ts`.

`ENVIRON` overrides your shell, so the result never depends on who runs it. Secrets get placeholders, never real values.

### Recognition Rules and Acknowledged Unknowns (`rules.py` / `rules.ts`)

```python
RECOGNITION: list[Rule] = [
    # a project construct, by dotted name
    Rule(name="drafts_login_required", evidence="shop/views.py:78",
         authn="required", authz="none", construct="shop.views.DraftsView.dispatch"),
    # a middleware guarding a prefix: invisible to the script otherwise
    Rule(name="tenant_middleware", evidence="config/middleware.py:11",
         authn="required", authz="none", path_prefix="/api/", layer="global", raw="TenantMiddleware"),
]
ACKNOWLEDGED: list[Ack] = [
    Ack(reason="IsOwner compares obj.owner in has_object_permission; ownership is data, not configuration",
        construct="shop.permissions.IsOwner"),
    Ack(reason="GraphQL operations are out of scope; authorization is enforced per resolver", path="/graphql/"),
]
```

```ts
export const RECOGNITION: Rule[] = [
  // conditional rule first: for one construct, the first matching rule wins
  { name: 'session_public', evidence: 'src/auth/session.guard.ts:8', authn: 'anonymous', authz: 'none',
    construct: 'SessionGuard', whenMetadata: { isPublic: true } },
  { name: 'session', evidence: 'src/auth/session.guard.ts:8', authn: 'required', authz: 'none', construct: 'SessionGuard' },
  { name: 'roles', evidence: 'src/auth/roles.guard.ts:8', authn: 'required', authz: 'rule',
    construct: 'RolesGuard', rawMetadata: 'roles' },
  { name: 'partner_key', evidence: 'src/partner/partner-key.middleware.ts:7', authn: 'required', authz: 'none',
    pathPrefix: '/api/partner/', layer: 'global', raw: 'PartnerKeyMiddleware' },
];
export const NEUTRAL: Neutral[] = [];   // guards that are not access control (throttling, logging)
export const ACKNOWLEDGED: Ack[] = [
  { reason: 'SignatureGuard checks a signature carried in the request body', construct: 'SignatureGuard' },
];
```

- `evidence` points at the line of the `class` / `def` / `function` that implements the check, never at a usage site. For a construct from an installed package, cite the project line that applies it. The script refuses a rule whose evidence file does not exist.
- A check that differs for reads: `safe_authn` / `safe_authz` (Django) or `safeAuthn` / `safeAuthz` (NestJS) apply to GET / HEAD / OPTIONS.
- NestJS metadata (`@Public()`, `@Roles()`) is matched with `whenMetadata` and shown in `raw` with `rawMetadata`.

See the stack references for how to read each kind of construct: [`references/django.md`](skills/all-access-inspector/references/django.md), [`references/nestjs.md`](skills/all-access-inspector/references/nestjs.md), [`references/spring.md`](skills/all-access-inspector/references/spring.md), [`references/symfony.md`](skills/all-access-inspector/references/symfony.md).

### Dimensions and expected access (`dimensions.py` / `dimensions.ts`)

```python
DIMENSIONS = {"access_tier": ["public", "customer", "staff"]}

EXPECTED = {
    "access_tier": {
        "public":   {"authentication": ["anonymous", "optional"], "authorization": ["none"]},
        "customer": {"authentication": ["required"], "authorization": ["none", "rule"]},
        "staff":    {"authentication": ["required"], "authorization": ["rule"]},
    }
}

RULES = [  # most specific first; every endpoint must get a value for every dimension
    Assign("access_tier", "staff", lambda e: e.path.startswith("/admin/")),
    Assign("access_tier", "customer", lambda e: e.path.startswith(("/api/", "/reports/"))),
    Assign("access_tier", "public", lambda e: e.path.startswith(PUBLIC)),
]
```

- An endpoint that no rule assigns stops the run with exit 2 and names the endpoint. This is deliberate, so new paths are never silently labelled.
- `EXPECTED` may leave a value out: that zone is not checked. `unknown` is never an expected value.
- An endpoint outside its expected access is **not** an error. The inventory records it and the viewer flags it.

### Spring and Symfony

The same three blocks, in Java and PHP. From the fixtures:

```java
// Boot.java
@SpringBootTest(classes = com.acme.Application.class, webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@ActiveProfiles("prod")
class Boot {
  static final String PROFILE_REASON = "production profile, set by SPRING_PROFILES_ACTIVE in the Dockerfile";
  static final List<Pin> PINNED = List.of(
      new Pin("app.jwt-secret", "inventory-placeholder", "secret required at boot by src/main/java/com/acme/security/SecurityConfig.java:19"));
  @MockitoBean @Reason("payment gateway reachable from production only") com.acme.payments.PaymentClient payments;
  // …
}

// Rules.java
static final List<Rule> RECOGNITION = List.of(
    Rule.construct("can_read", "src/main/java/com/acme/security/PermissionEvaluator.java:10",
        "@PreAuthorize(\"@permissionEvaluator.canRead(#id)\")", "required", "rule"),
    Rule.pathPrefix("partner_key", "src/main/java/com/acme/PartnerKeyFilter.java:22", "/partner/", "global", "required", "none"));
static final List<Ack> ACKNOWLEDGED = List.of(
    Ack.construct("reachable from the office network only, which the firewall enforces as well",
        "access(\"hasIpAddress('10.0.0.0/8')\")"));
```

```php
// src/Boot.php
public const KERNEL = 'App\Kernel';
public const ENV = 'prod';
public static function environ(): array
{
    return [new Env('TRUSTED_IPS', '10.0.0.0/8', 'the office network, set by the deployment; access_control reads it')];
}

// src/Rules.php
public static function recognition(): array
{
    return [Rule::construct('project_view', 'src/Security/ProjectVoter.php:18', "#[IsGranted('PROJECT_VIEW', subject: 'project')]", 'required', 'rule')];
}
public static function acknowledged(): array
{
    return [Ack::construct("an admin or the book's owner deletes it; the owner is known once the book is loaded",
        "security: is_granted('ROLE_ADMIN') or object.owner == user")];
}
```

- `construct` is the check exactly as `--unknowns` shows it in `raw`: after `-> ` for a filter-chain or `access_control` entry, the whole `raw` for an annotation, an attribute, a `denyAccessUnlessGranted()` call or an API Platform `security` expression.
- `evidence` is the line that decides: the method a SpEL expression calls, the voter's `voteOnAttribute`, an `AuthorizationManager`'s `check`, or the line where a filter or authenticator rejects the request.
- A check that lets reads through: `.safe("anonymous", "none")` (Spring) or `->safe('anonymous', 'none')` (Symfony).
- Spring stubs are `@MockitoBean` fields with a `@Reason`. `Boot` refuses a stub of a `SecurityFilterChain`, an `AuthorizationManager`, a `PermissionEvaluator`, a controller or the application class, and a pinned `spring.profiles.active`.
- Symfony's `Boot` refuses `APP_ENV` and `APP_DEBUG` in `environ()`, a name set twice, and an entry without a reason.

See [`references/spring.md`](skills/all-access-inspector/references/spring.md) and [`references/symfony.md`](skills/all-access-inspector/references/symfony.md).

## Review the fitting

The human review of the fitting commit is the trust gate. Check:

- [ ] **Boot**: the entry is what production runs; every stub replaces a secret or an external service, never routing or access code; every `ENVIRON` value is the real production value.
- [ ] **Each Recognition Rule**: open its `evidence` line. Does the code enforce what `authn` / `authz` claims? Is `rule` deserved (a check beyond identity)?
- [ ] **Each Acknowledged Unknown**: can you verify its reason in one read?
- [ ] **Middleware**: every authenticating middleware has a path-prefix rule.
- [ ] **Zones**: the expected access per value matches what the team means. Look at the endpoints outside their zone.
- [ ] `--check` passes locally, and the CI snippet runs the same command.

## Limits

- **Checks inside handler bodies** (`if not request.user.is_staff: raise PermissionDenied`, a service-level check) are invisible: the endpoint reads `anonymous` / `none`. Grep the anonymous endpoints before accepting them.
- **Custom middleware** is not read. Without a path-prefix rule, its endpoints show the framework default.
- **Object-level checks** (ownership in `has_object_permission`) cannot be classified by configuration. Acknowledge them.
- **GraphQL / WebSocket / SSE**: the transport route is an endpoint. The operations inside it are out of scope and carry an acknowledgement.
- **Apps mounted outside the framework** (an Express router outside Nest, an ASGI sub-app) appear as unknown endpoints naming the callable.
- **Several patterns resolving to one Django path with different checks** are unknown: the first match wins at runtime.
- **NestJS**: `jest.config.ts` is not read (port it to `jest.config.cjs`). Only the Express adapter is supported, and Express 4 has no fixture.
- **Spring**: the filter chain is decided for one sample request per endpoint, with every path variable set to `1`, so a matcher more specific than the mapping can decide other requests differently. Functional routes (`RouterFunction`) and URL-mapped handlers are not listed, and the inventory says `best-effort`. WebFlux is not read. `server.servlet.context-path` is not part of the paths. In a multi-module build, run the script from each application module.
- **Symfony**: the firewall and `access_control` are decided for one sample request per endpoint. An entry with `ips`, `host` or another condition reads `unknown`. `$this->isGranted()` and checks in services are not read. The `access_decision_manager` strategy is assumed to be `affirmative`. Two routes that differ only by host show as one.
- **Reflection on framework internals** (Spring Security, Symfony Security): when a new version moves them, the endpoints read `unknown` with `… internals changed`, never a guess. Report it to the toolkit rather than writing rules around it.
- **Unsupported stacks** are always `best-effort`. A route added outside the registry the script reads (a hand-mounted sub-app, a raw ASGI or WSGI handler, a proxy) is missed. So is anything a gateway or reverse proxy enforces.
- The inventory records **facts**, not verdicts: whether `anonymous` is right for an endpoint is your call. Zones and expected access are how you state the intent.

The full lists are under "Blind spots" in each stack reference.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Exit 2 with a traceback and "cannot boot" | The app does not import in the pinned environment. Stub the secret, vault or client call the traceback points at, or `Env(...)` a required variable. See "Boot failure → stub cookbook" in the stack reference. Never stub the settings or a guard. |
| `boot.py` refuses a `Pin` or `Stub` | It would move a setting away from production or stub the settings package. Fix the cause instead. |
| NestJS: "package.json declares neither vitest nor jest" | `inspect.sh` runs through your test runner. Add one as a dev dependency. |
| NestJS: "stopped before the inspector reported" | The runner failed to start (config, transform, alias). Its output is printed above the message. |
| Exit 2: "no rule assigns dimension …" | A new path is not covered by `RULES`. Add an assignment. |
| Exit 2: "… not found: generate it first" | There is no `inventory.json` yet. Run the script without options. |
| Exit 2: "cannot read … inventory.json" | A merge conflict or a hand edit broke it. Regenerate it; never hand-merge it. |
| An inventory written by an older Base Script no longer loads | Regenerate it after a Base Script refresh, before `--check`. |
| Spring: `cannot boot <class> with profile <profile>` | Read the deepest cause it prints. Add a `Pin` for a missing placeholder, or a `@MockitoBean` with a `@Reason` for a bean that connects at startup. See the stub cookbook in `references/spring.md`. |
| Spring: the build fails before the script reports | A compile error, a missing `spring-boot-starter-test`, or no `useJUnitPlatform()` in Gradle. The build's log is printed. |
| Symfony: `cannot boot … with env …: EnvNotFoundException` | Add an `Env` to `Boot::environ()`: a placeholder for a secret or a DSN, the production value for anything that shapes access. |
| Symfony: `<kernel> is final` | The script extends your kernel. Ask the team to drop `final`. |
| Symfony: `class App\Kernel not found` | Run `composer install`, or check `config/bundles.php` for a dev-only bundle registered for `all`. |
| An endpoint reads `… internals changed` | The framework moved an internal the script reads. Report it to the toolkit; do not write a rule around it. |
| Viewer: "not an Endpoint Inventory this viewer reads" | The file predates Base Script 0.3.0 or is not an inventory. Regenerate it. |

## Work on the toolkit

```
skills/all-access-inspector/
├── SKILL.md                     # the Agent's workflow
├── VERSION
├── base-scripts/django/         # Base Script + tests (uv, pytest, ruff, mypy); access_map/: the Map Introspect
├── base-scripts/nestjs/         # Base Script + tests (pnpm, vitest, tsc)
├── base-scripts/spring/         # Base Script + tests (Maven, JUnit), Java 21
├── base-scripts/symfony/        # Base Script + tests (Composer, PHPUnit)
├── review/                      # review CLI (Node 24, zero dependencies)
├── map/                         # map CLI and the static page.html (Node 24)
├── references/                  # per-stack knowledge the Agent reads
├── schema/                      # inventory, review event, runtime and vocabulary schemas + canonical samples
├── assets/                      # CI snippet templates, summary template
└── viewer/inventory-viewer.html
fixtures/                        # django-demo, nestjs-demo, nestjs-jest-smoke, spring-demo, spring-gradle-smoke, symfony-demo:
                                 # fitted projects with golden inventories; django-demo also has a fitted access map
apps/review/                     # the Next.js review app
docs/                            # ADRs, PRD, user flows, plan
CONTEXT.md                       # the domain glossary
```

```bash
make install-nestjs install-symfony install-review   # once
pnpm --dir apps/review exec playwright install chromium   # once, for the app's e2e tests
make test             # Base Script unit tests + golden tests on every fixture + make test-review
make test-review      # review CLI, map CLI and review app tests, then the app's Playwright e2e
make check-all        # ruff, mypy, deptry, tsc
make format
```

- Java and PHP run in Docker (`eclipse-temurin:21-jdk`, `composer:2`) with their caches in volumes, so you need neither on your machine. CI, which has them, sets `SPRING_RUN=` and `SYMFONY_RUN=` to run them directly.
- The fixtures vendor the Base Script. A golden test checks that each vendored copy matches the Base Script outside its project section, so copy changes into the fixtures.
- After a change in classification, regenerate the fixture goldens (`expected/inventory.json`) by running the script in the fixture and moving the output into `expected/`. Review that diff like any inventory diff.
- The same goes for the Map Introspect: `fixtures/django-demo/expected/runtime.json` is checked against a fresh run, and `tools/access-map/runtime.json` must stay identical to it.
- Keep the Core Classification closed. A new framework construct becomes a Built-in Rule, never a new value.

Design decisions: [ADR 0001: the Agent fits once, the script runs forever](docs/adr/0001-agent-fits-once-script-runs-forever.md), [ADR 0002: runtime discovery is the source of truth](docs/adr/0002-runtime-discovery-is-the-source-of-truth.md), [ADR 0003: the Adapted Script is vendored](docs/adr/0003-adapted-script-is-vendored.md), [ADR 0004: review state is an event log](docs/adr/0004-review-state-is-an-event-log.md), [ADR 0005: access facts are read before they are written](docs/adr/0005-access-facts-are-read-before-they-are-written.md), [ADR 0006: the access map is a view of the review app](docs/adr/0006-the-access-map-is-a-view-of-the-review-app.md). Vocabulary: [`CONTEXT.md`](CONTEXT.md).
