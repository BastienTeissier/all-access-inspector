---
name: all-access-inspector
description: Fit the All Access Inspector to a project, so it can regenerate and CI-check the inventory of every HTTP endpoint with its authentication and authorization, deterministically and without an LLM. Use when asked to inventory endpoints or access control, to fit or update tools/access-inspector/, to resolve its unknowns, to triage the inventory: read the handlers the review queue has not cleared and point at the ones a human should look at first, or to build the access map: per role and per capability, whether the role passes, how far over the records, and where each fact was read.
---

# All Access Inspector

You are the Agent. You fit a Base Script to one project once. You leave behind an Adapted Script in `tools/access-inspector/`, and from then on the project regenerates and checks its Endpoint Inventory with no LLM involved.

The workflow below is the same for every stack. What differs (file names, the command, where the production entry and the middleware live, how a rule is written) is in the stack's reference, `<skill>/references/<stack>.md`. Read it before step 3 and follow it wherever a step points to it.

## Stack terms

| Term | Django | NestJS | Spring | Symfony |
|---|---|---|---|---|
| app root | the directory that holds `manage.py` | the directory that holds the app's `package.json` | the module that holds the application class and its `pom.xml` / `build.gradle*` | the directory that holds `composer.json` and `src/Kernel.php` |
| `<inspect>` | `<run> python tools/access-inspector/inspect.py` | `tools/access-inspector/inspect.sh` | `tools/access-inspector/inspect.sh` | `php tools/access-inspector/inspect.php` |
| boot / rules / dimensions file | `boot.py`, `rules.py`, `dimensions.py` | `boot.ts`, `rules.ts`, `dimensions.ts` | `Boot.java`, `Rules.java`, `Dimensions.java` in `src/test/java/accessinspector/` | `src/Boot.php`, `src/Rules.php`, `src/Dimensions.php` in `tools/access-inspector/` |
| project section | `# --- project ---` … `# --- end project ---` | `// --- project ---` … `// --- end project ---` | `// --- project ---` … `// --- end project ---` | `// --- project ---` … `// --- end project ---` |
| production entry | `ENTRY`, the settings module | `ENTRY`, the root module, and `CONFIGURE`, the setup function | `@SpringBootTest(classes = …)`, the application class, and `@ActiveProfiles` | `Boot::KERNEL`, the kernel class, and `Boot::ENV`, its `APP_ENV` |
| boot entries | `Env`, `Stub`, `Pin` | `Env`, `Stub` | `Pin`, `@MockitoBean` fields with `@Reason` | `Env` in `Boot::environ()` |
| rule fields | `path_prefix`, `safe_authn`, `safe_authz` | `pathPrefix`, `safeAuthn`, `safeAuthz`, `whenMetadata`, `rawMetadata` | `Rule.construct`, `Rule.pathPrefix`, `.safe(…)`, `.raw(…)` | `Rule::construct`, `Rule::pathPrefix`, `->safe(…)`, `->withRaw(…)` |

Paths below are relative to this skill's base directory (`<skill>/`) or to the app root.

## Hard rules

- Never edit a CI pipeline file. Propose `tools/access-inspector/ci-snippet.*` and let the team wire it in.
- Never stub what decides the routes or the access checks: the settings module (Django); a guard, a controller, an `APP_GUARD` or the root module (NestJS); a `SecurityFilterChain`, an `AuthorizationManager`, a controller or the application class (Spring); `security.yaml`, a voter, a controller or the kernel (Symfony). Stub only secrets, databases and external services. A pin or an `ENVIRON` value may move a setting only toward production. The boot file enforces part of this (the reference's stub cookbook says which part); the other `ENVIRON` values are on you. Do not work around its checks.
- Never write a Recognition Rule without evidence: a `file:line` in the project that shows the construct the rule interprets. Never map a construct whose meaning the source does not settle. Ask instead, or acknowledge it as unknown.
- Never fall back to static discovery because the boot is hard. Static discovery is admissible only when the routing layer cannot be enumerated at runtime.
- Never claim `coverage: complete` for a stack that has no Base Script.
- Never remove or rename a Core Classification field or value. Project-specific code goes only in the project section of the boot, rules and dimensions files. Everything else stays byte-identical to the Base Script, so a later refresh can replace it. An improvised Adapted Script (unsupported stack) is the one exception: it keeps, extends or rewrites each file of the Base Script it derives from, as `<skill>/references/unsupported.md` § What stays and what you write lists them.
- Change nothing outside `tools/access-inspector/` except one entry per linter or type checker the project runs, excluding `tools/access-inspector/` from it. The vendored files follow the toolkit's style, not the project's.
- Never commit on the current branch, and never push.
- Write to the Review Log (`tools/access-inspector/reviews.jsonl`) only through `review append --agent`, and never give a Verdict: only a human does.

## Workflow

### 1. Detect the stack

| Signal | Stack | Base Script |
|---|---|---|
| `manage.py`, or `django` in `pyproject.toml` / `requirements*.txt` / `setup.cfg` | Django | `<skill>/base-scripts/django/`, reference `<skill>/references/django.md` |
| `@nestjs/core` in `package.json` | NestJS | `<skill>/base-scripts/nestjs/`, reference `<skill>/references/nestjs.md` |
| `pom.xml` / `build.gradle*` with `spring-boot` | Spring | `<skill>/base-scripts/spring/`, reference `<skill>/references/spring.md` |
| `composer.json` with `symfony/framework-bundle` | Symfony | `<skill>/base-scripts/symfony/`, reference `<skill>/references/symfony.md` |
| anything else (FastAPI, Flask, Express, Laravel, Rails…) | unsupported | the closest Base Script, per `<skill>/references/unsupported.md` |

Tell the user which Base Script you use. If none is shipped for the stack, name the stack, say no Base Script exists for it, and follow `<skill>/references/unsupported.md`: pick the closest Base Script and say which and why, improvise the Adapted Script from it, and mark the inventory `coverage: best-effort`. Stop, with nothing committed, when the project has no route registry and no recognisable routing. Read the stack's reference (for an unsupported stack, `unsupported.md` and the closest stack's) before going further.

If the repository holds several bootable applications (several Django settings packages, several Nest apps in a monorepo, several application modules of a Maven or Gradle build, several Symfony kernels), ask which ones to fit. Each one gets its own `tools/access-inspector/` in its own app root.

### 2. Existing fitting?

If `tools/access-inspector/` already exists, switch to **Update mode** (below) and skip steps 3 to 5.

### 3. Vendor the Base Script

Copy the Base Script into `tools/access-inspector/` as the reference's "Vendor and run" says, with `cp -L` for `VERSION` (a symlink in the toolkit). These copies are the Adapted Script. Every command below is `<inspect> …`, run from the app root.

### 4. Pin the Boot Environment

1. Find the production entry (the reference's "Production entry") and set it in the boot file. Find the environment reads that shape routes, middleware or access checks (the reference's "Environment") and pin each one in `ENVIRON` to its production value, asking the user when the source does not say what production sets.
2. Run `<inspect> --table`. Exit 2 with an error means the boot failed. Read it and apply the reference's stub cookbook. Add the boot entry it names, with its reason, then run again.
3. When a failure needs a value only the team knows (a feature flag's production value, a required service), ask one question with the error excerpt. Do not guess.

Exit 0 means the boot is done. Every boot entry carries a reason in the boot file.

### 5. Resolve every unknown

Run `<inspect> --unknowns`. It prints one JSON line per endpoint whose authentication or authorization is `unknown`. For each distinct construct (the `raw` of the unknown axis, with the `handler`):

1. Read the construct's source: the guard, permission class, decorator or overridden method, or the middleware for its paths.
2. If the source settles what it enforces, add a `Rule` to `RECOGNITION` in the rules file. Give it a `name`, the `evidence` `path/from/app/root:line` of the construct's class or function line, and `authn`/`authz` from the Core Classification. Target either the `construct` or a path prefix with a `layer`. The reference's "Writing a Recognition Rule" explains how to read each kind.
3. If the source cannot settle it (ownership checks on data, per-resolver GraphQL, an external policy engine), add an `Ack` to `ACKNOWLEDGED` with a reason a reviewer can verify, and target the `construct` or the exact `path`.
4. Ask the user only when the source leaves the meaning open. Ask one question, with the source excerpt.

Rerun `--unknowns` until it prints only endpoints that carry an `unknown_reason`. Then check for silent gaps: middleware that guards a prefix is invisible to the script (the reference's "Blind spots" says where middleware is registered). Review every middleware and add a path-prefix rule where one enforces authentication or authorization.

### 6. Propose Project Dimensions

1. Draft one or two dimensions with candidate values from what you found: path prefixes, guarding middleware, admin, roles named in rules. See "Candidate dimensions" in the reference.
2. For each value, show the user the assignment rule and the endpoints it covers, by path prefix with counts.
3. For each value, propose its expected access from what the value means, never from what the endpoints currently get: the `authentication` values and the `authorization` values an endpoint of that value may have (`unknown` is never expected). For example `public`: anonymous or optional, none; `staff`: required, rule. Name the endpoints that fall outside it.
4. Ask with AskUserQuestion: confirm, rename, merge or reject, per dimension, and confirm or correct each value's expected access. A value the user gives no expectation is left out.
5. Write the confirmed result in the dimensions file: `DIMENSIONS`, then `EXPECTED`, then `RULES` with the most specific rule first. If the user rejects every dimension, leave all three empty.

An endpoint outside its value's expected access is not an error: the inventory records it and the viewer flags it. Never change a rule or an expectation to hide one; list them in the summary.

Exit 2 naming an endpoint means a rule misses it. Extend the rules; never add a catch-all the user did not confirm.

### 7. Write the inventory and the CI snippet

1. Run `<inspect> --table` and show the user the result, or a summary of it when it is long.
2. Run `<inspect>` to write `tools/access-inspector/inventory.json`, then `<inspect> --check`. It must exit 0.
3. Pick the template in `<skill>/assets/ci-snippets/` that matches the project's CI: `github-actions.yml` when `.github/workflows/` exists, `gitlab-ci.yml` for `.gitlab-ci.yml`, `generic.sh` otherwise. Fill `{{setup}}`, `{{install}}` and `{{check}}` from the project's own test job, then write it as `tools/access-inspector/ci-snippet.<ext>` and check it parses. Do not touch the pipeline.
4. Tell the user how to look at the result: open `<skill>/viewer/inventory-viewer.html` in a browser and load `tools/access-inspector/inventory.json` (file picker or drag-and-drop). Give the absolute path of both. Nothing is copied into the project. The viewer shows the inventory only. Say that who passes per role and per capability (the access map, with its Alerts, Roles, Routes and How it's built tabs) comes once the fit is committed, by asking for the access map (§ Map).
   Then run `node <skill>/review/src/cli.ts status <project>` and show the user its header and tier counts: that is where their review starts. Never append a Verdict yourself: only the user gives one.
5. Find every linter and type checker the project's CI or pre-commit hook runs over the whole tree. Exclude `tools/access-inspector/` in each one's configuration, as the reference's "Linters" says, then run them: they must pass as they did before the fit.

### 8. Branch, commit, summary

1. Infer the branch convention from recent branches (`git branch -a --sort=-committerdate | head -20`, e.g. `feat/…`, `chore/…`). Fall back to `access-inspector/fit`. Create the branch from the current HEAD.
2. Stage `tools/access-inspector/` (excluding caches and `reviews.jsonl`, which the reviewers commit) and the linter exclusions from step 7. Verify with `git status --short` that no other file changed.
3. Commit following the project's commit convention. The body lists every boot decision, Recognition Rule and Acknowledged Unknown.
4. Print the summary from `<skill>/assets/summary-template.md`.

## Update mode

A project already has `tools/access-inspector/`. Keep what the team decided and work only on what changed.

1. Read the project sections of the boot, rules and dimensions files. Each of these entries survives byte for byte unless step 2 or 4 changes it. If the inventory's `stack` differs from `base_script.stack`, the Adapted Script was improvised: follow `<skill>/references/unsupported.md` § Update mode, which offers a re-base once a Base Script exists for the stack.
2. Check each Recognition Rule's evidence. If the file and line still show the construct, keep the rule. If the construct moved, grep for it and update the evidence. If it is gone, remove the rule and give the reason in the summary.
3. Run `<inspect> --check`.
   - Exit 2 from a boot error: fix the boot file under the same toward-production rule, without touching rules.
   - Exit 2 from a missing dimension: extend the dimensions file, asking for any new value.
4. Run `--unknowns` and resolve only the new ones, as in step 5.
5. Refresh the Base Script only when the user asks. Replace each vendored file with the current Base Script file, keeping the project's project section, and update `VERSION`. When the new Base Script's project section declares something the kept one lacks (e.g. a new `ENVIRON` list, or `EXPECTED`), add that declaration with the Base Script's empty default, then offer to fill `EXPECTED` as in step 6. Then regenerate `inventory.json` before running `--check`: an inventory written by an older Base Script may not load. The inventory diff shows any endpoint whose classification the toolkit change moved; list those endpoints in the summary.
6. Leave `reviews.jsonl` and `tools/access-inspector/.gitattributes` as they are: they are not vendored files, and a refresh neither replaces nor deletes them. A regenerated inventory makes the affected Verdicts outdated on its own, through replay.
7. Regenerate `inventory.json` and run `--check`. If neither `tools/access-inspector/` nor `inventory.json` changed, say "no change" and do not commit. Otherwise do step 8, with a summary limited to what changed.

## Triage

The user asks you to triage the inventory. The deterministic tiers see only the inventory's facts; you read the handlers and point at what they cannot see. Your output only reorders the Review Queue: it never clears an endpoint.

`<review>` below is `node <skill>/review/src/cli.ts` (Node 24.2 or later), and `<project>` is the app root.

1. Check that `tools/access-inspector/inventory.json` is committed (`git ls-files`). If it is not, tell the user to fit the project first and stop.
2. Run `<review> status <project> --json`. Each line is one queued row.
3. Pick the scope: rows with `triage` true. The CLI leaves out:
   - rows a human gave a valid Verdict;
   - rows an authorization rule decides alone, since judging a rule is the reviewer's work;
   - rows whose agent event still holds for their current classification.

   If the user named endpoints or a path prefix, keep only those.
4. For each row in scope, open its `handler` (`file:line`) and read it with the stack reference's "Triage checklist". A handler that is a dotted name with no project file is third-party: read the project line that mounts it, or skip the row and say why.
5. Decide one event per row:
   - `signal_raised`, when something in the handler needs a human: a one-line `reason` (at most 500 characters) and the `evidence` you read, as `relative/path:line`;
   - `triaged`, when you found nothing.
6. Append all of them in one call, so they share one batch:
   ```bash
   <review> append <project> --agent --model <your model id> <<'EOF'
   {"event":"signal_raised","method":"POST","path":"/api/orders/{pk}/refund/","reason":"…","evidence":"shop/api.py:24"}
   {"event":"triaged","method":"GET","path":"/catalog/status"}
   EOF
   ```
   Add `"handler"` to a line when the method and path have several handlers. A refusal (exit 2) writes nothing: fix the line it names and run the call again.
7. Print a summary: the endpoints you read, the files that changed (`reviews.jsonl`, and `.gitattributes` when the CLI created it), every Signal you raised with its reason, and every row you skipped with why. Tell the user to run `<review> status <project>`: a Signal lifts its row to tier 7, "suggested by the agent", unless the row already sits in a higher tier, where it shows beside the other Signals.

Never give a Verdict, never edit the inventory or the Adapted Script, and never commit. Only `reviews.jsonl` changes, plus `tools/access-inspector/.gitattributes` on the first run in a project (the CLI adds its `merge=union` line). The user commits both.

## Map

The user asks for the access map: per Role and per Capability, whether the role passes, its Scope, and the Basis of each fact. `<map>` below is `node <skill>/map/src/cli.ts` (Node 24.2 or later), and `<project>` is the app root. The map joins four sources and decides nothing itself:

| Source | Where | Who writes it |
|---|---|---|
| Endpoint Inventory and Review Log | `tools/access-inspector/` | the Adapted Script, the reviewers |
| Map Runtime | `tools/access-map/runtime.json`, committed | the stack's Map Introspect, when it has one (today: Django) |
| Map Vocabulary | `tools/access-map/vocabulary.json`, committed | you, with the user |
| page | `<skill>/map/page.html` | the toolkit; never copied into the project |

Hard rules for the map, besides the ones above:

- Read before you write. A fact the code declares in a form a program can read (a dict, an enum, a config file, an annotation, a filter used the same way everywhere) is a Map Rule in the introspect's project section, with its `file:line`. The vocabulary holds only what no program can read, each entry with the `reason` it was not extracted. `map check` fails on a vocabulary entry a Map Rule already produces.
- Add no role the code does not define. Not signed in is added by the toolkit.
- Whether a role passes a capability is computed. Never write it, and never write a `who` into a route check that the cited line does not settle.
- Never decide a cell. A Capability Decision is a human's, through `<map> decide` or the review app.
- Never write the project's `CONTEXT.md`, and never edit a pinned anchor by hand: fix the reference at its source, then pin again.

1. Check that `tools/access-inspector/inventory.json` is committed. If it is not, fit the project first and stop.
2. Read the stack reference's "Map introspect". When the stack has one, vendor it into `tools/access-map/` as it says, and exclude `tools/access-map/` from the linters as the reference's "Linters" says. When it has none, the runtime stays empty, every fact goes in the vocabulary, and you keep a list of the facts you saw in a readable form ("could be extracted").
3. Read the roles from the code, where the reference's "Map introspect" says they live: groups and their grants, the superuser bypass, what the sign-in assigns to every account, who passes staff checks. Give each a kind (`signed_in`, `superuser`, `group`) from evidence. Write them as Map Rules (`roles()`, `includes()`, `staff()`, `grants()`), then the scopes and capabilities the code declares uniformly (`scopes()`, `scoped()`, `capabilities()`). Show the user each Map Rule with its evidence before saving it, as for a Recognition Rule. Run the introspect, then its `--check`: it must exit 0.
4. Map each role and each area to the project's docs: `CONTEXT.md` when it exists, else the README or `docs/`, else the defining model or class, always as a `file:line` (`doc_at` on a role, `defined_at` on an area). Report every role the docs name and the code does not, and the reverse. When the project has no `CONTEXT.md`, propose starting one in the summary.
5. Write the vocabulary with the user, only for what no program read, each entry with its `reason`: capability names in the glossary's words (`extends` an extracted capability), capabilities one action spans or outside any pattern (`endpoints`, `check`, `evidence`, `replaces`), scopes not read by a rule, checks inside handler bodies (`route_checks`), `domains` and `resources`, and the stack section the reference names. The shapes are in `<skill>/schema/vocabulary.schema.json`. When the stack section feeds the introspect (Django `stack.admin_actions`), run the introspect again. Ask with AskUserQuestion when a name or a grouping is the team's call.
6. Run `<map> pin <project>`, which records the text of every `file:line` the vocabulary cites, then `<map> check <project>`. Exit 2 names an invalid file: fix it. Exit 1 lists the problems: fix each one except the partial capabilities, which the user decides. Leave those listed.
7. Run `<map> build <project>` and give the user the absolute path of `tools/access-map/out/access-map.html`. Propose ignoring `tools/access-map/out/`. Tell them the same map, with a decision form on each cell, is the review app's Access map (`node <skill>/review/src/cli.ts app <project>`).
8. Branch (fallback `access-map/fit`) and commit as in step 8 of the fit: stage `tools/access-map/` without `out/`, plus the linter exclusions. The body lists every Map Rule and every vocabulary entry with its reason.
9. Print the "Access map" part of `<skill>/assets/summary-template.md`: the coverage `map check` prints, the partial capabilities left for the user to decide, the docs mismatches, and the "could be extracted" list.

### Look at the map

The user asks you to look at the access map. For each cell in scope (the partial and open ones, or the ones the user names), read the capability's `check` and its endpoints in `runtime.json` and `vocabulary.json`, then the code they cite: does the role reach what it should, and only that? Append one event per cell you read, in one call:

```bash
node <skill>/review/src/cli.ts append <project> --agent --model <your model id> <<'EOF2'
{"event":"signal_raised","capability":["export-orders","clerk"],"reason":"…","evidence":"shop/admin.py:24"}
{"event":"triaged","capability":["shop.order.view","manager"]}
EOF2
```

A Signal shows under Alerts as an Agent signal. It never decides the cell: never append `decided`, and never run `<map> decide`.
