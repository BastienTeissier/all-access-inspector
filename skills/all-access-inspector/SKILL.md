---
name: all-access-inspector
description: Inventory every HTTP endpoint's authentication and authorization, and map who passes what. Use to fit the All Access Inspector to a project, update a fitting in tools/access-inspector/, triage the inventory, or build or read the access map.
---

# All Access Inspector

You are the Agent. You fit a Base Script to one project once. You leave behind an Adapted Script in `tools/access-inspector/`, and from then on the project regenerates and checks its Endpoint Inventory with no LLM involved.

The workflows are the same for every stack. What differs (the app root, `<inspect>`, file names, where the production entry and the middleware live, how a rule is written) is in the stack's reference, `<skill>/references/<stack>.md`, its only source. Paths are relative to this skill's base directory (`<skill>/`) or to the app root.

## Detect the stack

| Signal | Stack | Base Script |
|---|---|---|
| `manage.py`, or `django` in `pyproject.toml` / `requirements*.txt` / `setup.cfg` | Django | `<skill>/base-scripts/django/`, reference `<skill>/references/django.md` |
| `@nestjs/core` in `package.json` | NestJS | `<skill>/base-scripts/nestjs/`, reference `<skill>/references/nestjs.md` |
| `pom.xml` / `build.gradle*` with `spring-boot` | Spring | `<skill>/base-scripts/spring/`, reference `<skill>/references/spring.md` |
| `composer.json` with `symfony/framework-bundle` | Symfony | `<skill>/base-scripts/symfony/`, reference `<skill>/references/symfony.md` |
| anything else (FastAPI, Flask, Express, Laravel, Rails…) | unsupported | the closest Base Script, per `<skill>/references/unsupported.md` |

Tell the user which Base Script you use. If none is shipped for the stack, name the stack, say no Base Script exists for it, and follow `<skill>/references/unsupported.md`: pick the closest Base Script and say which and why, improvise the Adapted Script from it, and mark the inventory `coverage: best-effort`. Stop, with nothing committed, when the project has no route registry and no recognisable routing. Read the stack's reference (for an unsupported stack, `unsupported.md` and the closest stack's) before going further.

If the repository holds several bootable applications (several Django settings packages, several Nest apps in a monorepo, several application modules of a Maven or Gradle build, several Symfony kernels), ask which ones to fit. Each one gets its own `tools/access-inspector/` in its own app root.

## Pick the workflow

Read one workflow file, then follow it with the stack reference open beside it.

| The user asks to | Entry condition | Workflow | Reference sections it reads |
|---|---|---|---|
| inventory the endpoints, fit the inspector, resolve its unknowns | no `tools/access-inspector/` in the app root | `<skill>/workflows/fit.md` | Vendor and run, Where access is decided, by layer, Production entry, Environment, Boot failure, Writing a Recognition Rule, Acknowledged Unknowns, Blind spots, Candidate dimensions, Linters |
| fit, update or refresh the fitting | `tools/access-inspector/` exists | `<skill>/workflows/update.md` | the same as the fit, for what changed |
| triage the inventory, point at the handlers to read first | `inventory.json` committed | `<skill>/workflows/triage.md` | Triage checklist |
| build the access map, or look at it | `inventory.json` committed | `<skill>/workflows/map.md` | Map introspect, Linters |

For the first two rows the entry condition picks the workflow: "fit" or "resolve its unknowns" on a project that has `tools/access-inspector/` is an update. A run that fits and then maps reads `fit.md`, then `map.md`. An unsupported stack follows `fit.md` with `unsupported.md` beside the closest stack's reference.

## Hard rules

Every workflow keeps these. Each is stated here only.

- **Evidence.** Every Recognition Rule, Map Rule and route check cites a `file:line` in the project that shows the construct it interprets. When the source does not settle a construct's meaning, ask the user or acknowledge it as unknown; a rule without evidence is never written.
- **Toward production.** Stub only secrets, databases and external services; what decides the routes or the access checks stays as production builds it (the reference's "Boot failure → stub cookbook" names it per stack). A pin or an `ENVIRON` value moves a setting only toward production. The boot file enforces part of this; the rest is on you, and its checks are never worked around.
- **Project section.** Project-specific code goes in the project section of the boot, rules and dimensions files and of the Map Introspect. Everything else stays byte-identical to the Base Script, so a later refresh can replace it, and every Core Classification field and value keeps its name. An improvised Adapted Script is the one exception: it keeps, extends or rewrites each file as `<skill>/references/unsupported.md` § What stays and what you write lists them.
- **Footprint.** Changes stay in `tools/access-inspector/` and `tools/access-map/`, plus one exclusion of those directories per linter or type checker the project runs. The vendored files follow the toolkit's style, not the project's. A CI pipeline belongs to the team: propose `tools/access-inspector/ci-snippet.*` and let them wire it in.
- **Branch.** Commit on a new branch and stop; pushing and merging belong to the user.
- **Human decisions.** Verdicts and Capability Decisions are a human's. You write to the Review Log (`tools/access-inspector/reviews.jsonl`) only through `review append --agent`, with `signal_raised` and `triaged` events.
