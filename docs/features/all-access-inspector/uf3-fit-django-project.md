# UF3: Fit a Django project with the Agent

**Notion ticket:** *(not requested)*

## Context

A developer or security auditor invokes the all-access-inspector skill inside a real Django project that has no Adapted Script yet. The Agent turns the Base Script into an Adapted Script that boots this project, interprets its constructs, and leaves a commit to review.

## Specification

AAU (developer or auditor), invoking the skill in a repository without `tools/access-inspector/`, I see the Agent:
- detect Django and say which Base Script it will use
- copy the Base Script into `tools/access-inspector/`
- determine the production-like settings module, try to boot, and stub only secrets, databases and external services, moving a routing-shaping setting only toward production, with each stub and its reason written in `boot.py`
- run the script and list every `unknown`
- for each unknown, read the project construct, and either write a Recognition Rule in `rules.py` citing file and line, or write an Acknowledged Unknown with a reason, asking me only when the source does not settle the meaning
- rerun until no unexplained unknown remains
- propose Project Dimensions (see UF4)
- write `inventory.json` and `ci-snippet.yml`
- create a branch, commit, and print a summary: boot decisions, each Recognition Rule with its evidence, each Acknowledged Unknown with its reason, endpoint counts per classification

## Success Scenario

- AAU, the project has a `TenantMiddleware` rejecting unauthenticated requests under `/api/`, I see a Recognition Rule setting authentication `required` at layer `global` for that prefix, citing the middleware's file and line.
- AAU, the project has a custom `IsOrderOwner` permission, I see a Recognition Rule mapping it to authorization `rule`, citing the class.
- AAU, the settings import a secrets manager, I see a stub for the manager and the settings module left untouched.
- AAU, `DEBUG` defaults to true from the environment, I see it pinned to false in `boot.py` with the reason.

## Error Scenario

- AAU, the Agent cannot boot the project after stubbing, I see the remaining error and a question about the missing piece; the Agent does not switch to static discovery.
- AAU, the project's routing layer is custom and cannot be enumerated at runtime, I see the Agent state this, choose static discovery, write the reason in the Adapted Script, and mark the inventory `best-effort`.

## Edge Cases

- AAU, if the repository holds two bootable Django applications, the Agent asks which one to fit and creates one Adapted Script per application chosen.
- AAU, if a construct's meaning cannot be settled from source, the Agent asks me a single question with the source excerpt rather than guessing.
- AAU, if the Agent is interrupted, nothing is committed; the working tree holds the partial Adapted Script for the next run (see UF5).

## Acceptance Criteria

- [ ] The committed branch contains `tools/access-inspector/` with entrypoint, `boot.py`, `rules.py`, `dimensions.py`, `inventory.json`, `ci-snippet.yml`.
- [ ] Every Recognition Rule cites a file and line that exists in the project at that commit.
- [ ] Every remaining `unknown` in `inventory.json` has a non-empty reason.
- [ ] No stub replaces a settings module or moves a routing-shaping setting away from production.
- [ ] `--check` passes on the committed branch.
- [ ] The summary lists every rule, unknown and boot decision.
- [ ] First milestone: one real Django project fitted and the branch merged.
