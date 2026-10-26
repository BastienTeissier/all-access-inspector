# PRD: All Access Inspector

## Why

- Developers and security auditors need a complete, trustworthy list of every HTTP endpoint an application exposes, with its authentication and authorization, that can be regenerated identically in CI.
- Three stack-specific tools exist today (django-access-inspector, spring-access-inspector, accent). Each has a different mechanism, a different output shape, silent blind spots and unstable ordering, so none can gate CI or feed a stack-agnostic audit.
- The toolkit replaces them with one contract (the Endpoint Inventory), one Base Script per stack, and an Agent that fits a Base Script to a project once. After fitting, no LLM is involved: the Adapted Script committed in the project produces the inventory deterministically.
- Business value: access-control regressions become a reviewable diff on every PR, audits start from facts instead of a scanner's guess, and fitting a new project is hours of Agent-assisted work instead of days of manual mapping.
- Facts are not judgements. The first real fit (moi, 514 endpoints, none outside its expected access) showed that a complete inventory is unusable by a human without a way to record, per endpoint, whether its access is right, and an order to review in. The Review Log, a ranked Review Queue and a local review app (UF12 to UF15) turn the inventory into a review that finishes and stays current as the code moves.

Vocabulary used in this document is defined in [CONTEXT.md](../../../CONTEXT.md). Foundational decisions are recorded in [docs/adr](../../adr/).

## Result

### Acceptance Criteria

- [ ] Running an Adapted Script twice on the same commit produces byte-identical inventories on any machine.
- [ ] Every endpoint the framework mounts appears in the inventory; none is dropped, including unnamed, framework-provided and admin routes.
- [ ] Every endpoint carries the closed Core Classification; a construct the script cannot interpret yields `unknown`, never a guess.
- [ ] After fitting, every remaining `unknown` carries a written reason, and every Recognition Rule cites a file and line that exists.
- [ ] `--check` exits non-zero on any difference from the Committed Inventory and prints a per-endpoint diff.
- [ ] The security-audit skill produces an audit from a Committed Inventory without booting the application.
- [ ] Each Base Script passes a golden-file test against its fixture project.
- [ ] A reviewer can record a Verdict per endpoint; it is kept with the code, its history is never rewritten, and it goes outdated when the endpoint's access changes.
- [ ] The Review Queue orders unreviewed endpoints deterministically by fixed tiers, from the same inventory and log on any machine.
- [ ] The Agent can raise Signals on handlers but never gives a Verdict.

### Features

- One shared inventory schema that every Base Script validates against.
- Runtime Base Scripts for Django, NestJS, Spring and Symfony, each with a fixture project and built-in rules for framework constructs.
- A Claude Code skill (the Agent) that detects the stack, vendors the Base Script, pins a production-like Boot Environment, resolves unknowns with evidence-cited Recognition Rules, proposes Project Dimensions, and commits on a branch.
- `--check` mode and a proposed CI snippet so the Committed Inventory gates every PR.
- An uncommitted table view rendered from the inventory for humans.
- An update mode for projects that already have an Adapted Script.
- A stack-agnostic reference and parse script in the security-audit skill.
- A Review Log committed beside the inventory, with a `review` command line: queue status and appending Verdicts.
- A Triage mode of the skill: the Agent reads unreviewed handlers and raises advisory Signals.
- A local review app: queue, endpoint panel, Verdicts, bulk review and history.

### Visual

Inventory contract (one endpoint object per line, sorted by path, then method, then handler):

```json
{"schema_version": "1", "stack": "django", "discovery_mode": "runtime", "coverage": "complete",
 "boot_environment": {"settings_module": "config.settings.production", "stubs": ["secrets manager (config/secrets.py)"]},
 "project_dimensions": {"access_tier": ["public", "customer", "back-office"]},
 "endpoints": [
  {"method": "GET", "path": "/api/orders/{id}/", "handler": "orders/views.py:42",
   "authentication": {"value": "required", "layer": "class", "raw": "IsAuthenticated", "rule": "builtin:IsAuthenticated"},
   "authorization": {"value": "rule", "layer": "method", "raw": "IsOrderOwner", "rule": "recognition:IsOrderOwner"},
   "dimensions": {"access_tier": "customer"}, "unknown_reason": null},
  {"method": "POST", "path": "/graphql/", "handler": "config/urls.py:18",
   "authentication": {"value": "optional", "layer": "global", "raw": "SessionAuthentication", "rule": "builtin:SessionAuthentication"},
   "authorization": {"value": "unknown", "layer": null, "raw": null, "rule": null},
   "dimensions": {"access_tier": "customer"}, "unknown_reason": "GraphQL operations are out of scope; authorization is enforced per resolver"}
 ]}
```

Layout left by the Agent in the audited project:

```
tools/access-inspector/
  inspect.py            # Adapted Script entrypoint: inspect.py [--check] [--table]
  boot.py               # pinned Boot Environment (settings module, stubs, reasons)
  rules.py              # built-in rules (from the Base Script) + Recognition Rules with evidence
  dimensions.py         # Project Dimensions and their assignment rules
  inventory.json        # Committed Inventory
  ci-snippet.yml        # proposed CI step, not wired in
```

Review Log (`tools/access-inspector/reviews.jsonl`, append-only, one event per line):

```json
{"v":1,"at":"2026-10-15T10:02:00Z","by":"bastien.teissier@theodo.com","event":"reviewed","batch":null,"endpoint":["GET","/perseus/api/body-part-tree/","moi/api/body_part_tree/view.py"],"verdict":"safe","reason":"queryset filtered by request.user, moi/api/body_part_tree/view.py:40","seen":{"handler":"moi/api/body_part_tree/view.py:27","authentication":{"value":"required","layer":"class","raw":"IsAuthenticated","rule":"builtin:IsAuthenticated"},"authorization":{"value":"none","layer":"class","raw":"IsAuthenticated","rule":"builtin:IsAuthenticated"},"inside":true}}
{"v":1,"at":"2026-10-15T11:40:12Z","by":"agent:claude-opus-5-5","event":"signal_raised","batch":"t-7f3a","endpoint":["GET","/admin/perseus/ocrmetricsadmincard/export-csv/","django.contrib.admin.options.ModelAdmin"],"reason":"exports every OCR metric row; check the queryset","evidence":"moi/admin/ocr_metrics_admin_card.py:184","seen":{…}}
```

Toolkit layout:

```
all-access-inspector/
  apm.yml               # APM package: users depend on it, pinned by tag
  skills/all-access-inspector/
    SKILL.md            # the Agent workflow
    references/{django,nestjs,spring,symfony}.md
    assets/             # CI snippets, summary template
    base-scripts/{django,nestjs,spring,symfony}/
    schema/inventory.schema.json
  fixtures/{django,nestjs,spring,symfony}-demo/ + expected inventory.json
  skills/all-access-inspector/review/   # Review Log schema, replay, Signals, tiers, `review` CLI (TypeScript, no dependency, ships with the skill)
  apps/review/          # local review app (Next.js), built on the review package, run from a toolkit checkout
```

### Use cases / edge cases

Fitting journey:

```
developer invokes skill in repo
  → detect stack ──unsupported──▶ improvise from closest Base Script, coverage = best-effort (UF9)
  → existing Adapted Script? ──yes──▶ update mode (UF5)
  → vendor Base Script, pin Boot Environment (toward production only)
  → run → unknowns?
        ├─ construct found in source → Recognition Rule + evidence
        ├─ not interpretable → Acknowledged Unknown with reason
        └─ boot fails → fix boot, never fall back to static unless routing is not enumerable
  → propose Project Dimensions → user confirms
  → write inventory.json, ci-snippet.yml → commit on branch → summary
```

Review journey:

```
inventory.json + reviews.jsonl
  → replay: per Review Key, latest Verdict → valid / outdated / moot / orphaned
  → deterministic Signals + agent Signals → tier per endpoint
  → Review Queue (no valid Verdict), tier then path then method
reviewer: CLI or app → Verdict → append `reviewed` → commit with the code → PR review
agent (Triage): read handler → append `signal_raised` / `triaged` (never a Verdict)
code changes → regenerated inventory → replay marks Verdicts outdated or orphaned → back in the queue
```

Edge cases identified:

- A view with no URL name, or two views sharing a name: both appear, identified by method, path and handler.
- A viewset with `IsAuthenticatedOrReadOnly`: GET is `optional`, POST is `required`; one endpoint per method.
- A handler with no method restriction: a single endpoint with method `ANY`.
- A custom permission class with a suggestive name: `unknown` until a Recognition Rule cites it.
- A middleware authenticating a prefix: Recognition Rule sets `required` at layer `global`.
- `DEBUG` defaulting to true from the environment: the Boot Environment sets it false and records why.
- A secrets manager imported at settings import time: stubbed, the settings module is not.
- Route table depends on a feature flag: the flag is pinned; the difference is a reviewable diff, not an environment variant.
- Monorepo with two bootable apps: two Adapted Scripts, two Committed Inventories.
- GraphQL or WebSocket transport: the route is in, authorization is an Acknowledged Unknown.
- Spring `SecurityFilterChain` with overlapping matchers: the first matching rule wins, as in Spring; the raw matcher is kept.
- Symfony `access_control` plus `#[IsGranted]` on the same endpoint: both recorded, global layer and method layer.
- NestJS global guard skipped by `@Public()` metadata: classified per endpoint from the metadata, as the guard reads it.
- CI fails on a new unknown: resolved by hand, by update mode, or by acknowledging with a reason.
- A handler shifts lines within its file: Verdicts stay valid (the Review Key strips the line).
- A handler moves file or a path is renamed: the Verdict is orphaned, never re-attached; its reason can be copied.
- A reviewed endpoint changes inside its expected access without changing values (`login_required` → `LoginRequiredMixin`): the Verdict stays valid.
- Two branches append Verdicts on one endpoint: both lines survive the merge; the later one wins.
- An endpoint added after a bulk review: not covered, it enters the queue.

### User Flows

| UF | Name | File |
|----|------|------|
| UF1 | Inventory a Django project | [uf1-inventory-django-project.md](./uf1-inventory-django-project.md) |
| UF2 | Enforce the inventory in CI | [uf2-enforce-inventory-in-ci.md](./uf2-enforce-inventory-in-ci.md) |
| UF3 | Fit a Django project with the Agent | [uf3-fit-django-project.md](./uf3-fit-django-project.md) |
| UF4 | Label endpoints with the project's vocabulary | [uf4-label-with-project-dimensions.md](./uf4-label-with-project-dimensions.md) |
| UF5 | Update an existing fitting | [uf5-update-existing-fitting.md](./uf5-update-existing-fitting.md) |
| UF6 | Audit from the Committed Inventory | [uf6-audit-from-committed-inventory.md](./uf6-audit-from-committed-inventory.md) |
| UF7 | Inventory a Spring project | [uf7-inventory-spring-project.md](./uf7-inventory-spring-project.md) |
| UF8 | Inventory a Symfony project | [uf8-inventory-symfony-project.md](./uf8-inventory-symfony-project.md) |
| UF9 | Fit an unsupported stack | [uf9-fit-unsupported-stack.md](./uf9-fit-unsupported-stack.md) |
| UF10 | Inventory a NestJS project | [uf10-inventory-nestjs-project.md](./uf10-inventory-nestjs-project.md) |
| UF11 | View the inventory | [uf11-view-inventory.md](./uf11-view-inventory.md) |
| UF12 | Track reviews from the command line | [uf12-track-reviews-from-cli.md](./uf12-track-reviews-from-cli.md) |
| UF13 | Triage the inventory with the Agent | [uf13-triage-with-agent.md](./uf13-triage-with-agent.md) |
| UF14 | Review endpoints in the app | [uf14-review-in-app.md](./uf14-review-in-app.md) |
| UF15 | Review in bulk and read the history | [uf15-bulk-review-and-history.md](./uf15-bulk-review-and-history.md) |

*(Each UF is documented in its own file. Notion integration was not requested.)*

## Decisions

- The Agent fits once; the Adapted Script runs without it (ADR 0001).
- Runtime discovery is the source of truth; static only when routing cannot be enumerated (ADR 0002).
- The Adapted Script is a vendored copy, not a dependency (ADR 0003).
- The inventory records facts only. Verdicts live in the Review Log, never in the inventory; risk analysis of a whole application stays with the security-audit skill.
- Review state is an append-only event log committed beside the inventory; any database is a disposable projection (ADR 0004).
- Verdicts: `safe`, `accepted` (optional expiry), `finding` (severity, optional ticket). Only a human gives one; a `finding` closes through an outdated Verdict followed by `safe`.
- Review Key: method, path, handler with the line stripped. Outdated is derived on replay: inside expected access, a change of authentication or authorization value; outside it, any change of the reviewed classification.
- The Review Queue uses eleven fixed tiers, the same for every project; a weighted score was rejected as unexplainable.
- A bulk review writes one event per endpoint; a selector never stands for endpoints.
- Agent Signals are advisory, stored, and outdated like Verdicts; deterministic Signals are recomputed, never stored.
- The review logic lives once in a TypeScript package used by the CLI, the app and the skill; Base Scripts are untouched.
- The review app runs locally and never runs git; the reviewer commits the log.
- Review work ships before the Spring Base Script.
- The Committed Inventory is the CI snapshot; there is no policy file in this version.
- The Agent commits on a new branch; it proposes a CI snippet and never edits the pipeline.
- Project Dimensions are proposed by the Agent and confirmed by the user; an endpoint without a value for a declared dimension is a script failure, never a null.
- A handler with no method restriction is one `ANY` endpoint; per-method rules expand into explicit methods.
- In update mode a Recognition Rule whose evidence disappeared is removed and named in the summary; moved evidence is updated.
- The security-audit skill warns and proceeds on a stale Committed Inventory.
- For an unsupported stack the Agent improvises from the closest Base Script and marks the inventory `best-effort`.
- Users are the project's developers and security auditors; both review the Adapted Script commit, which is the trust gate.

### Out of Scope

- A CI policy gate on top of the inventory diff (candidate for a later version).
- Evaluating authorization rules into a role-to-endpoint matrix.
- Operations inside GraphQL, WebSockets or server-sent events.
- Merged inventories across several applications of one repository.
- Automated Agent evals before the workflow stabilises.
- Publishing Base Scripts as packages.
- Stacks other than Django, NestJS, Spring and Symfony as supported Base Scripts.
- A hosted, multi-project review app; CVE, web vitals or other metrics in the app.
- The app committing, pushing or opening PRs.
- A CI step reporting outdated Verdicts, and checking that a Verdict's author matches its commit author (part of the deferred CI policy gate).
- Publishing the review package or app to npm.
- Hashing handler source to detect body changes.

## Technical Specification

### Architecture

- **Schema** (`schema/inventory.schema.json`): the single shared artefact. Every Base Script validates its output against it; the table renderer and the security-audit parse script read only this.
- **Base Scripts** (`base-scripts/<stack>/`): runtime discovery. Django walks the URL resolver after `django.setup()` with a pinned settings module; NestJS boots the application module in a test-scoped harness without listening and reads the routes and guards Nest registered; Spring boots a test-scoped context with a pinned profile and dumps `RequestMappingHandlerMapping` plus the `SecurityFilterChain` authorization rules and method-security annotations; Symfony boots the kernel with a pinned env and reads the router, `access_control`, controller attributes and API Platform metadata.
- **Agent** (`SKILL.md`): detect stack, vendor, pin boot, loop on unknowns, propose dimensions, commit. Reads `references/<stack>.md` for where auth lives on each stack and known blind spots.
- **Adapted Script** (`tools/access-inspector/` in the project): entrypoint with `--check` and `--table`, boot module, rules module, dimensions module, Committed Inventory, CI snippet.
- **Review package** (`skills/all-access-inspector/review/`, ships with the skill so Triage works from an installed skill): event schema, replay against the inventory, outdated/moot/orphaned rules, deterministic Signals, tiers, and the `review` CLI (`status`, `append`, `append --agent`, `app`). Reads only the inventory schema, so it works for every stack.
- **Review app** (`apps/review/`): local Next.js app over the package; SQLite projection rebuilt from the files and refreshed when they change; writes only through the package's append.
- **Triage**: a section of `SKILL.md` and a triage checklist in each stack reference; writes through `review append --agent`.
- **security-audit skill**: new reference `access-inspector.md` and `parse_access_inspector.sh` reading the Committed Inventory; the Django-specific reference is retired.

### Libraries & tools

- Django Base Script: Python standard library plus the project's own Django; `jsonschema` for validation in tests only.
- NestJS Base Script: TypeScript run by the project's own test runner (vitest or jest) and `@nestjs/testing`; no new dependency.
- Spring Base Script: Spring Boot test support of the project; Jackson for output; no Spoon.
- Symfony Base Script: Symfony console and routing of the project; API Platform metadata factory when present.
- Table view: a single renderer per Base Script language reading the schema; no committed HTML.
- Agent: Claude Code skill, distributed through this repository (APM, target `claude`).
- Review package: TypeScript run directly by Node 24 (type stripping), no dependency. App: Next.js with pnpm; `node:sqlite` for the projection (built in, no native build). The app runs from a checkout of the toolkit until distribution is decided.

### Data Requirements

- No application data is read; only the route table and security configuration of the booted application.
- Stubs replace secrets, databases and external services during boot; the inventory never contains their values.
- Inventory contains relative handler paths only, no absolute paths, no timestamps.
- `reviews.jsonl`: events with schema version, date, author (git email or `agent:<model id>`), event type, batch id, Review Key, the classification seen, and type-specific fields. Append-only; `.gitattributes` sets `merge=union` on it.
- The app's SQLite file lives outside the project and is never committed.

### Rights & Permissions

| Permission | Description | User Roles |
|------------|-------------|------------|
| Run the Adapted Script | Boot the app in the pinned environment and write the inventory | Any developer, CI |
| Fit or update with the Agent | Modify `tools/access-inspector/` and commit on a branch | Developer, security auditor |
| Merge the Adapted Script | Accept Recognition Rules and Acknowledged Unknowns | Reviewer of the PR |
| Give a Verdict | Append a `reviewed` event through the CLI or the app | Developer, security reviewer (human only) |
| Raise a Signal | Append `signal_raised` or `triaged` through `append --agent` | Agent |
| Merge Verdicts | Accept the Review Log diff | Reviewer of the PR |

### Testing strategy

- One fixture project per stack exercising every built-in rule and every trap found in the old tools; a golden `inventory.json` compared byte for byte.
- Schema validation of every fixture inventory.
- `--check` tested with a modified fixture: exit code and diff output.
- Agent: first proof is one real Django project fitted and merged; eval fixtures deferred.
- Review package: unit tests per tier, per Signal and per Verdict state on small inventories built in tests; replay of the fixture inventories with a fixture log; CLI tests on exit codes and refusals.
- Review app: end-to-end tests of the queue, the Verdict form and bulk review on a fixture project; the queue checked against `review status`.

## Production strategy

- Metrics: number of repositories with a green `--check` on every PR; unknown ratio per project after fitting (target near zero); fitting effort in wall-clock time and human interventions; access-control findings the security-audit skill surfaces from inventories.
- Error cases: boot failure (script exits non-zero with the boot error and the pinned environment), schema violation (script exits non-zero, never writes a partial inventory), `--check` drift (exit non-zero with per-endpoint diff), unsupported stack (Agent states it and marks coverage `best-effort`).
- No telemetry is collected by the Adapted Script; metrics come from CI status and from the inventories themselves.
- Review metrics, read from the Review Log: share of endpoints with a valid Verdict per project; outdated Verdicts waiting; findings opened and closed; agent Signals that ended as a `finding`.
