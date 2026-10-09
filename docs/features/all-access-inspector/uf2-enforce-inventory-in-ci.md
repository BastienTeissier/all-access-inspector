# UF2: Enforce the inventory in CI

**Notion ticket:** *(not requested)*

## Context

Once an inventory exists, the team wants every change to exposed endpoints or their access control to show up as a reviewable diff on the PR, with no policy to maintain.

## Specification

AAU (developer), running `python tools/access-inspector/inspect.py --check`, I see:
- exit code 0 and "inventory up to date" when the regenerated inventory equals the Committed Inventory
- exit code 1 and a per-endpoint diff (added, removed, changed, with the changed fields) when they differ
- a hint telling me to run the script without `--check` and commit the result if the change is intended

AAU (developer), looking at `tools/access-inspector/ci-snippet.yml`, I see a ready-to-paste step for the CI system detected in the repository (GitHub Actions, GitLab CI, or a generic shell step) that installs nothing beyond the project's own stack and runs `--check`.

## Success Scenario

- AAU, I add an endpoint without regenerating the inventory, the CI step fails and the diff names the new endpoint with its classification.
- AAU, I change a permission class from `IsAdminUser` to `AllowAny`, the diff shows the endpoint with authorization `rule` → `none` and authentication `required` → `optional`.
- AAU, I regenerate and commit the inventory in the same PR, the reviewer sees the inventory change beside the code change and CI is green.

## Error Scenario

- AAU, the application fails to boot in CI, I see the boot error and the pinned Boot Environment, and the step fails without touching the Committed Inventory.
- AAU, `inventory.json` is missing, `--check` fails and tells me to generate it first.

## Edge Cases

- AAU, if the only difference is ordering or whitespace, there is no difference, because the inventory is canonical.
- AAU, if the inventory was generated on macOS and checked on Linux, there is no difference, because handler paths are relative and no environment-specific value is written.
- AAU, if a new endpoint is `unknown`, the diff flags it as such so the reviewer knows a Recognition Rule or an Acknowledged Unknown is expected (see UF5).

## Acceptance Criteria

- [ ] `--check` exits 0 on an unchanged fixture and 1 after any modification of a fixture endpoint.
- [ ] The diff output lists each changed endpoint with the fields that changed.
- [ ] `--check` never writes `inventory.json`.
- [ ] The CI snippet runs `--check` with no dependency outside the project's stack.
- [ ] Ordering, whitespace and run location produce no diff.
