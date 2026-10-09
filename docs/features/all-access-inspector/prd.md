# PRD: All Access Inspector

## Why

- Developers and security auditors need a complete, trustworthy list of every HTTP endpoint an application exposes, with its authentication and authorization, that can be regenerated identically in CI.
- Three stack-specific tools exist today (django-access-inspector, spring-access-inspector, accent). Each has a different mechanism, a different output shape, silent blind spots and unstable ordering, so none can gate CI or feed a stack-agnostic audit.
- The toolkit replaces them with one contract (the Endpoint Inventory), one Base Script per stack, and an Agent that fits a Base Script to a project once. After fitting, no LLM is involved: the Adapted Script committed in the project produces the inventory deterministically.
- Business value: access-control regressions become a reviewable diff on every PR, audits start from facts instead of a scanner's guess, and fitting a new project is hours of Agent-assisted work instead of days of manual mapping.

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

### Features

- One shared inventory schema that every Base Script validates against.
- Runtime Base Scripts for Django, Spring and Symfony, each with a fixture project and built-in rules for framework constructs.
- A Claude Code skill (the Agent) that detects the stack, vendors the Base Script, pins a production-like Boot Environment, resolves unknowns with evidence-cited Recognition Rules, proposes Project Dimensions, and commits on a branch.
- `--check` mode and a proposed CI snippet so the Committed Inventory gates every PR.
- An uncommitted table view rendered from the inventory for humans.
- An update mode for projects that already have an Adapted Script.
- A stack-agnostic reference and parse script in the security-audit skill.

### Visual

Inventory contract (one endpoint object per line, sorted by path then method):

```json
{"schema_version": "1", "stack": "django", "discovery_mode": "runtime", "coverage": "complete",
 "boot_environment": {"settings_module": "config.settings.production", "stubs": ["secrets manager (config/secrets.py)"]},
 "project_dimensions": {"access_tier": ["public", "customer", "back-office"]},
 "endpoints": [
  {"method": "GET", "path": "/api/orders/{id}/", "handler": "orders/views.py:42",
   "authentication": {"value": "required", "layer": "class", "raw": "IsAuthenticated"},
   "authorization": {"value": "rule", "layer": "method", "raw": "IsOrderOwner", "rule": "recognition:IsOrderOwner"},
   "dimensions": {"access_tier": "customer"}, "unknown_reason": null},
  {"method": "POST", "path": "/graphql/", "handler": "config/urls.py:18",
   "authentication": {"value": "optional", "layer": "global", "raw": "SessionAuthentication"},
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

Toolkit layout:

```
all-access-inspector/
  SKILL.md              # the Agent workflow
  references/{django,spring,symfony}.md
  base-scripts/{django,spring,symfony}/
  schema/inventory.schema.json
  fixtures/{django,spring,symfony}-demo/ + expected inventory.json
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
- CI fails on a new unknown: resolved by hand, by update mode, or by acknowledging with a reason.

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

*(Each UF is documented in its own file. Notion integration was not requested.)*

## Decisions

- The Agent fits once; the Adapted Script runs without it (ADR 0001).
- Runtime discovery is the source of truth; static only when routing cannot be enumerated (ADR 0002).
- The Adapted Script is a vendored copy, not a dependency (ADR 0003).
- The inventory records facts only. Severity and verdicts belong to the security-audit skill.
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
- Stacks other than Django, Spring and Symfony as supported Base Scripts.

## Technical Specification

### Architecture

- **Schema** (`schema/inventory.schema.json`): the single shared artefact. Every Base Script validates its output against it; the table renderer and the security-audit parse script read only this.
- **Base Scripts** (`base-scripts/<stack>/`): runtime discovery. Django walks the URL resolver after `django.setup()` with a pinned settings module; Spring boots a test-scoped context with a pinned profile and dumps `RequestMappingHandlerMapping` plus the `SecurityFilterChain` authorization rules and method-security annotations; Symfony boots the kernel with a pinned env and reads the router, `access_control`, controller attributes and API Platform metadata.
- **Agent** (`SKILL.md`): detect stack, vendor, pin boot, loop on unknowns, propose dimensions, commit. Reads `references/<stack>.md` for where auth lives on each stack and known blind spots.
- **Adapted Script** (`tools/access-inspector/` in the project): entrypoint with `--check` and `--table`, boot module, rules module, dimensions module, Committed Inventory, CI snippet.
- **security-audit skill**: new reference `access-inspector.md` and `parse_access_inspector.sh` reading the Committed Inventory; the Django-specific reference is retired.

### Libraries & tools

- Django Base Script: Python standard library plus the project's own Django; `jsonschema` for validation in tests only.
- Spring Base Script: Spring Boot test support of the project; Jackson for output; no Spoon.
- Symfony Base Script: Symfony console and routing of the project; API Platform metadata factory when present.
- Table view: a single renderer per Base Script language reading the schema; no committed HTML.
- Agent: Claude Code skill, distributed through this repository (APM, target `claude`).

### Data Requirements

- No application data is read; only the route table and security configuration of the booted application.
- Stubs replace secrets, databases and external services during boot; the inventory never contains their values.
- Inventory contains relative handler paths only, no absolute paths, no timestamps.

### Rights & Permissions

| Permission | Description | User Roles |
|------------|-------------|------------|
| Run the Adapted Script | Boot the app in the pinned environment and write the inventory | Any developer, CI |
| Fit or update with the Agent | Modify `tools/access-inspector/` and commit on a branch | Developer, security auditor |
| Merge the Adapted Script | Accept Recognition Rules and Acknowledged Unknowns | Reviewer of the PR |

### Testing strategy

- One fixture project per stack exercising every built-in rule and every trap found in the old tools; a golden `inventory.json` compared byte for byte.
- Schema validation of every fixture inventory.
- `--check` tested with a modified fixture: exit code and diff output.
- Agent: first proof is one real Django project fitted and merged; eval fixtures deferred.

## Production strategy

- Metrics: number of repositories with a green `--check` on every PR; unknown ratio per project after fitting (target near zero); fitting effort in wall-clock time and human interventions; access-control findings the security-audit skill surfaces from inventories.
- Error cases: boot failure (script exits non-zero with the boot error and the pinned environment), schema violation (script exits non-zero, never writes a partial inventory), `--check` drift (exit non-zero with per-endpoint diff), unsupported stack (Agent states it and marks coverage `best-effort`).
- No telemetry is collected by the Adapted Script; metrics come from CI status and from the inventories themselves.
