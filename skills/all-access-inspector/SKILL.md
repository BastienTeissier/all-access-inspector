---
name: all-access-inspector
description: Fit the All Access Inspector to a project, so it can regenerate and CI-check the inventory of every HTTP endpoint with its authentication and authorization, deterministically and without an LLM. Use when asked to inventory endpoints or access control, to fit or update tools/access-inspector/, or to resolve its unknowns.
---

# All Access Inspector

You are the Agent. You fit a Base Script to one project once. You leave behind an Adapted Script in `tools/access-inspector/`, and from then on the project regenerates and checks its Endpoint Inventory with no LLM involved.

Paths below are relative to this skill's base directory (`<skill>/`) or to the project root, the directory that holds `manage.py` and `tools/`.

## Hard rules

- Never edit a CI pipeline file. Propose `tools/access-inspector/ci-snippet.*` and let the team wire it in.
- Never stub a settings module. Stub only secrets, databases and external services. A pin or an `ENVIRON` value may move a setting only toward production. `boot.py` enforces the settings-module rule and the `DEBUG` pin, not `ENVIRON` values: those are on you. Do not work around either check.
- Never write a Recognition Rule without evidence: a `file:line` in the project that shows the construct the rule interprets. Never map a construct whose meaning the source does not settle. Ask instead, or acknowledge it as unknown.
- Never fall back to static discovery because the boot is hard. Static discovery is admissible only when the routing layer cannot be enumerated at runtime.
- Never claim `coverage: complete` for a stack that has no Base Script.
- Never remove or rename a Core Classification field or value. Project-specific code goes only between `# --- project ---` and `# --- end project ---` in `boot.py`, `rules.py` and `dimensions.py`. Everything else stays byte-identical to the Base Script, so a later refresh can replace it.
- Change nothing outside `tools/access-inspector/` except one entry per linter or type checker the project runs (`ruff`, `mypy`, `flake8`, `pyright`, …), excluding `tools/access-inspector/` from it. The vendored files follow the toolkit's style, not the project's.
- Never commit on the current branch, and never push.

## Workflow

### 1. Detect the stack

| Signal | Stack | Base Script |
|---|---|---|
| `manage.py`, or `django` in `pyproject.toml` / `requirements*.txt` / `setup.cfg` | Django | `<skill>/base-scripts/django/`, reference `<skill>/references/django.md` |
| `pom.xml` / `build.gradle*` with spring-boot | Spring | not shipped in this version |
| `composer.json` with `symfony/framework-bundle` | Symfony | not shipped in this version |

Tell the user which Base Script you use. If none is shipped for the stack, say so and stop. Read the stack's reference before going further.

If the repository holds several bootable applications (several `manage.py` or settings packages), ask which ones to fit. Each one gets its own `tools/access-inspector/`, placed next to its own `manage.py`.

### 2. Existing fitting?

If `tools/access-inspector/` already exists, switch to **Update mode** (below) and skip steps 3 to 5.

### 3. Vendor the Base Script

Copy every `*.py` of `<skill>/base-scripts/django/access_inspector/` except `__init__.py` into `tools/access-inspector/`. Also copy `VERSION`, dereferencing the symlink: `cp -L`. These copies are the Adapted Script.

Find how the project runs its Python, from its README, Makefile, `pyproject.toml`, Dockerfile or docker-compose (for example `uv run`, `poetry run`, an activated venv, `docker compose run web`). Call this `<run>`. Every command below is `<run> python tools/access-inspector/inspect.py …` from the directory that holds `manage.py`.

### 4. Pin the Boot Environment

1. Find the production settings module (see "Production entry" in the reference) and set `ENTRY` in `boot.py`.
   Grep the settings for environment reads (`os.environ`, `os.getenv`, `env(`) that shape `INSTALLED_APPS`, `MIDDLEWARE`, `ROOT_URLCONF` or the URLconf. Pin each one in `ENVIRON` to its production value, asking the user when the source does not say what production sets.
2. Run `inspect.py --table`. Exit 2 with a traceback means the boot failed. Read the traceback and apply the reference's stub cookbook. Add an `Env`, `Stub` or `Pin` with its reason, then run again.
3. When a failure needs a value only the team knows (a feature flag's production value, a required service), ask one question with the traceback excerpt. Do not guess.

Exit 0 means the boot is done. Every stub and pin carries a reason in `boot.py`.

### 5. Resolve every unknown

Run `inspect.py --unknowns`. It prints one JSON line per endpoint whose authentication or authorization is `unknown`. For each distinct construct (the `raw` of the unknown axis, with the `handler`):

1. Read the construct's source: the permission class, decorator, `test_func`, overridden method, or the middleware for its paths.
2. If the source settles what it enforces, add a `Rule` to `RECOGNITION` in `rules.py`. Give it a `name`, the `evidence` `path/from/project/root.py:line` of the construct's `class` or `def` line, and `authn`/`authz` from the Core Classification. Target either the dotted `construct` or a `path_prefix` with a `layer`. The reference explains how to read each kind.
3. If the source cannot settle it (ownership checks on data, per-resolver GraphQL, an external policy engine), add an `Ack` to `ACKNOWLEDGED` with a reason a reviewer can verify, and target the `construct` or the exact `path`.
4. Ask the user only when the source leaves the meaning open. Ask one question, with the source excerpt.

Rerun `--unknowns` until it prints only endpoints that carry an `unknown_reason`. Then check for silent gaps: middleware that guards a prefix is invisible to the script (see "Blind spots" in the reference). Grep `MIDDLEWARE` and add `path_prefix` rules where a middleware enforces authentication or authorization.

### 6. Propose Project Dimensions

1. Draft one or two dimensions with candidate values from what you found: path prefixes, guarding middleware, admin, roles named in rules. See "Candidate dimensions" in the reference.
2. For each value, show the user the assignment rule and the endpoints it covers, by path prefix with counts.
3. Ask with AskUserQuestion: confirm, rename, merge or reject, per dimension.
4. Write the confirmed result in `dimensions.py`: `DIMENSIONS`, then `RULES` with the most specific rule first. If the user rejects every dimension, leave both empty.

Exit 2 naming an endpoint means a rule misses it. Extend the rules; never add a catch-all the user did not confirm.

### 7. Write the inventory and the CI snippet

1. Run `inspect.py --table` and show the user the result, or a summary of it when it is long.
2. Run `inspect.py` to write `tools/access-inspector/inventory.json`, then `inspect.py --check`. It must exit 0.
3. Pick the template in `<skill>/assets/ci-snippets/` that matches the project's CI: `github-actions.yml` when `.github/workflows/` exists, `gitlab-ci.yml` for `.gitlab-ci.yml`, `generic.sh` otherwise. Fill `{{setup}}`, `{{install}}` and `{{check}}` from the project's own test job, then write it as `tools/access-inspector/ci-snippet.<ext>` and check it parses. Do not touch the pipeline.
4. Find every linter and type checker the project's CI or pre-commit hook runs over the whole tree. Exclude `tools/access-inspector/` in each one's configuration (`[tool.ruff] extend-exclude`, `[tool.mypy] exclude`, `setup.cfg`, …), then run them: they must pass as they did before the fit.

### 8. Branch, commit, summary

1. Infer the branch convention from recent branches (`git branch -a --sort=-committerdate | head -20`, e.g. `feat/…`, `chore/…`). Fall back to `access-inspector/fit`. Create the branch from the current HEAD.
2. Stage `tools/access-inspector/` (excluding caches) and the linter exclusions from step 7. Verify with `git status --short` that no other file changed.
3. Commit following the project's commit convention. The body lists every boot decision, Recognition Rule and Acknowledged Unknown.
4. Print the summary from `<skill>/assets/summary-template.md`.

## Update mode

A project already has `tools/access-inspector/`. Keep what the team decided and work only on what changed.

1. Read the project sections of `boot.py`, `rules.py` and `dimensions.py`. Each of these entries survives byte for byte unless step 2 or 4 changes it.
2. Check each Recognition Rule's evidence. If the file and line still show the construct, keep the rule. If the construct moved, grep for it and update the evidence. If it is gone, remove the rule and give the reason in the summary.
3. Run `inspect.py --check`.
   - Exit 2 from a boot error: fix `boot.py` under the same toward-production rule, without touching rules.
   - Exit 2 from a missing dimension: extend `dimensions.py`, asking for any new value.
4. Run `--unknowns` and resolve only the new ones, as in step 5.
5. Refresh the Base Script only when the user asks. Replace each vendored file with the current Base Script file, keeping the project's `# --- project ---` section, and update `VERSION`. When the new Base Script's project section declares something the kept one lacks (e.g. `ENVIRON: list[Env] = []`), add that declaration with the Base Script's empty default. Then regenerate `inventory.json` before running `--check`: an inventory written by an older Base Script may not load. The inventory diff shows any endpoint whose classification the toolkit change moved; list those endpoints in the summary.
6. Regenerate `inventory.json` and run `--check`. If neither `tools/access-inspector/` nor `inventory.json` changed, say "no change" and do not commit. Otherwise do step 8, with a summary limited to what changed.
