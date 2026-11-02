# Fit

Fit the Base Script to a project that has no `tools/access-inspector/` yet. You read `SKILL.md` and the stack's reference first; every step below follows that reference where it names a section. `<inspect>` and the file names are the reference's "Vendor and run".

Static discovery is admissible only when the routing layer cannot be enumerated at runtime: a hard boot is solved with boot entries, never by falling back to it. A stack with no Base Script is always `coverage: best-effort`; `coverage: complete` belongs to a shipped Base Script.

## 1. Vendor the Base Script

Copy the Base Script into `tools/access-inspector/` as the reference's "Vendor and run" says. These copies are the Adapted Script. Every command below is `<inspect> …`, run from the app root.

Done when `tools/access-inspector/` holds every file the reference lists, `VERSION` a regular file.

## 2. Pin the Boot Environment

1. Find the production entry (the reference's "Production entry") and set it in the boot file. Find the environment reads that shape routes, middleware or access checks (the reference's "Environment") and pin each one in `ENVIRON` to its production value, asking the user when the source does not say what production sets.
2. Run `<inspect> --table`. Exit 2 with an error means the boot failed. Read it and apply the reference's "Boot failure → stub cookbook". Add the boot entry it names, with its reason, then run again.
3. When a failure needs a value only the team knows (a feature flag's production value, a required service), ask one question with the error excerpt.

Done when `<inspect> --table` exits 0 and every boot entry carries a reason in the boot file.

## 3. Resolve every unknown

Run `<inspect> --unknowns`. It prints one JSON line per endpoint whose authentication or authorization is `unknown`. For each distinct construct (the `raw` of the unknown axis, with the `handler`):

1. Read the construct's source: the guard, permission class, decorator or overridden method, or the middleware for its paths.
2. If the source settles what it enforces, add a `Rule` to `RECOGNITION` in the rules file. Give it a `name`, the `evidence` `path/from/app/root:line` of the construct's class or function line, and `authn`/`authz` from the Core Classification. Target either the `construct` or a path prefix with a `layer`. The reference's "Writing a Recognition Rule" explains how to read each kind.
3. If the source cannot settle it (ownership checks on data, per-resolver GraphQL, an external policy engine), add an `Ack` to `ACKNOWLEDGED` with a reason a reviewer can verify, and target the `construct` or the exact `path`.
4. Ask the user only when the source leaves the meaning open. Ask one question, with the source excerpt.

Rerun `--unknowns`. Then check for silent gaps: middleware that guards a prefix is invisible to the script (the reference's "Blind spots" says where middleware is registered). Review every middleware and add a path-prefix rule where one enforces authentication or authorization.

Done when `--unknowns` prints only endpoints that carry an `unknown_reason`, and every middleware is reviewed.

## 4. Propose Project Dimensions

1. Draft one or two dimensions with candidate values from what you found: path prefixes, guarding middleware, admin, roles named in rules. See the reference's "Candidate dimensions".
2. For each value, show the user the assignment rule and the endpoints it covers, by path prefix with counts.
3. For each value, propose its expected access from what the value means, never from what the endpoints currently get: the `authentication` values and the `authorization` values an endpoint of that value may have (`unknown` is never expected). For example `public`: anonymous or optional, none; `staff`: required, rule. Name the endpoints that fall outside it.
4. Ask with AskUserQuestion: confirm, rename, merge or reject, per dimension, and confirm or correct each value's expected access. A value the user gives no expectation is left out.
5. Write the confirmed result in the dimensions file: `DIMENSIONS`, then `EXPECTED`, then `RULES` with the most specific rule first. If the user rejects every dimension, leave all three empty.

An endpoint outside its value's expected access is not an error: the inventory records it and the viewer flags it. Keep the rules and expectations the user confirmed, and list those endpoints in the summary.

Exit 2 naming an endpoint means a rule misses it. Extend the rules with what the user confirmed; a catch-all needs their confirmation too.

Done when the user has answered for every dimension and `<inspect> --table` exits 0.

## 5. Write the inventory and the CI snippet

1. Run `<inspect> --table` and show the user the result, or a summary of it when it is long.
2. Run `<inspect>` to write `tools/access-inspector/inventory.json`, then `<inspect> --check`. It must exit 0.
3. Pick the template in `<skill>/assets/ci-snippets/` that matches the project's CI: `github-actions.yml` when `.github/workflows/` exists, `gitlab-ci.yml` for `.gitlab-ci.yml`, `generic.sh` otherwise. Fill `{{setup}}`, `{{install}}` and `{{check}}` from the project's own test job, then write it as `tools/access-inspector/ci-snippet.<ext>` and check it parses.
4. Tell the user how to look at the result: open `<skill>/viewer/inventory-viewer.html` in a browser and load `tools/access-inspector/inventory.json` (file picker or drag-and-drop). Give the absolute path of both. Nothing is copied into the project. The viewer shows the inventory only. Say that who passes per role and per capability (the access map, with its Alerts, Roles, Routes and How it's built tabs) comes once the fit is committed, by asking for the access map (`workflows/map.md`).
   Then run `node <skill>/review/src/cli.ts status <project>` and show the user its header and tier counts: that is where their review starts.
5. Find every linter and type checker the project's CI or pre-commit hook runs over the whole tree. Exclude `tools/access-inspector/` in each one's configuration, as the reference's "Linters" says, then run them.

Done when `--check` exits 0, the snippet parses, and every linter passes as it did before the fit.

## 6. Branch, commit, summary

1. Infer the branch convention from recent branches (`git branch -a --sort=-committerdate | head -20`, e.g. `feat/…`, `chore/…`). Fall back to `access-inspector/fit`. Create the branch from the current HEAD.
2. Stage `tools/access-inspector/` (excluding caches and `reviews.jsonl`, which the reviewers commit) and the linter exclusions from step 5. Verify with `git status --short` that no other file changed.
3. Commit following the project's commit convention. The body lists every boot decision, Recognition Rule and Acknowledged Unknown.
4. Print the summary from `<skill>/assets/summary-template.md`.

Done when every unknown is resolved or acknowledged with a reason, `--check` exits 0 on the commit, and the summary is printed. When the user also asked for the access map, continue with `workflows/map.md`.
