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
- [What lands in your repository](#what-lands-in-your-repository)
- [Run the Adapted Script](#run-the-adapted-script)
- [Read the inventory](#read-the-inventory)
- [Look at it in the viewer](#look-at-it-in-the-viewer)
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
| Spring, Symfony | none yet | none | The skill says so and stops |

Base Script version: see [`skills/all-access-inspector/VERSION`](skills/all-access-inspector/VERSION) (currently 0.3.0). Every inventory records the version that produced it.

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
- the project's own toolchain, installed: its virtualenv / `uv` / `poetry` for Django, its `node_modules` for NestJS;
- the project able to import its code. The script boots the app but never serves it, and never needs a database.

## Fit a project

Open your agent in the project and ask:

```
/all-access-inspector
```

Or in plain words: *"inventory the endpoints of this app with their access control"*, *"fit the access inspector"*, *"resolve the access-inspector unknowns"*.

The Agent follows [`SKILL.md`](skills/all-access-inspector/SKILL.md). Expect a few questions; nothing is guessed.

### 1. Detect the stack

It reads `manage.py` / `pyproject.toml` / `package.json` and tells you which Base Script it uses. In a monorepo with several bootable apps, it asks which ones to fit. Each one gets its own `tools/access-inspector/` in its own app root.

If `tools/access-inspector/` already exists, it switches to [update mode](#update-the-fitting).

### 2. Vendor the Base Script

It copies the Base Script into `tools/access-inspector/`. That copy, the **Adapted Script**, is yours from now on (see [ADR 0003](docs/adr/0003-adapted-script-is-vendored.md)).

### 3. Pin the Boot Environment

The inventory must describe what **production** serves, not what a developer's laptop serves. The Agent:

- finds the production entry: the settings module production runs (Django), or the root module and the setup function `main.ts` applies (NestJS);
- pins every environment variable that shapes routes or access to its production value (`ENVIRON`);
- runs the script, reads the boot error, and stubs only what blocks the boot: secrets, vault clients, databases, caches, brokers.

It **never** stubs what decides routes or access checks: the settings module, a guard, a controller, the root module. A pin may only move a setting *toward* production (`DEBUG=False`, `NODE_ENV=production`). The boot file enforces part of this itself.

**You will be asked** when only the team knows a value, for example a feature flag's production setting. Each boot entry carries a written reason.

### 4. Resolve every unknown

The script emits `unknown` for any construct it cannot read: a custom decorator, a project permission class, a custom guard, an overridden admin site. For each one, the Agent reads the source and either:

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

## What lands in your repository

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

Plus one exclusion line per linter or type checker. Nothing else outside `tools/access-inspector/` changes.

Only the blocks between `# --- project ---` and `# --- end project ---` (`// --- project ---` in TypeScript) are project-specific. Everything else stays byte-identical to the Base Script, so a later refresh can replace it.

## Run the Adapted Script

Run from the app root: the directory that holds `manage.py` (Django) or the app's `package.json` (NestJS).

| Stack | Command |
|---|---|
| Django | `<run> python tools/access-inspector/inspect.py [option]`, with `<run>` = how the project runs Python (`uv run`, `poetry run`, `docker compose run web`, an activated venv) |
| NestJS | `tools/access-inspector/inspect.sh [option]`: it detects vitest or jest from `package.json`, and pnpm / yarn / bun / npm from the nearest lockfile |

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
  "base_script": {"stack": "django", "version": "0.3.0"},
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

Five hundred endpoints are too many to read one by one. The review CLI keeps track of what you checked and ranks what is left. It needs Node 24.2 or later and nothing else: no install, no build.

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

CI needs the same install as your tests. It needs no database, no secrets and no LLM.

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

See the stack references for how to read each kind of construct: [`references/django.md`](skills/all-access-inspector/references/django.md), [`references/nestjs.md`](skills/all-access-inspector/references/nestjs.md).

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
| Viewer: "not an Endpoint Inventory this viewer reads" | The file predates Base Script 0.3.0 or is not an inventory. Regenerate it. |

## Work on the toolkit

```
skills/all-access-inspector/
├── SKILL.md                     # the Agent's workflow
├── VERSION
├── base-scripts/django/         # Base Script + tests (uv, pytest, ruff, mypy)
├── base-scripts/nestjs/         # Base Script + tests (pnpm, vitest, tsc)
├── references/                  # per-stack knowledge the Agent reads
├── schema/                      # inventory.schema.json + canonical samples
├── assets/                      # CI snippet templates, summary template
└── viewer/inventory-viewer.html
fixtures/                        # django-demo, nestjs-demo, nestjs-jest-smoke: fitted projects with golden inventories
docs/                            # ADRs, PRD, user flows, plan
CONTEXT.md                       # the domain glossary
```

```bash
make install-nestjs   # once
make test             # Base Script unit tests + golden tests on every fixture
make check-all        # ruff, mypy, deptry, tsc
make format
```

- The fixtures vendor the Base Script. A golden test checks that each vendored copy matches the Base Script outside its project section, so copy changes into the fixtures.
- After a change in classification, regenerate the fixture goldens (`expected/inventory.json`) by running the script in the fixture and moving the output into `expected/`. Review that diff like any inventory diff.
- Keep the Core Classification closed. A new framework construct becomes a Built-in Rule, never a new value.

Design decisions: [ADR 0001: the Agent fits once, the script runs forever](docs/adr/0001-agent-fits-once-script-runs-forever.md), [ADR 0002: runtime discovery is the source of truth](docs/adr/0002-runtime-discovery-is-the-source-of-truth.md), [ADR 0003: the Adapted Script is vendored](docs/adr/0003-adapted-script-is-vendored.md). Vocabulary: [`CONTEXT.md`](CONTEXT.md).
