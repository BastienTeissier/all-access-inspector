# UF21: Coverage reported per area

**Notion ticket:** *(not requested)*

## Context

The map's step 5 ends wherever the Agent stops: nothing says how many endpoints sit behind a capability, nor which first-party ones are missing. Coverage is a report, never a failure: `map check` fails on what is wrong, and prints what is incomplete.

## Specification

AAU (developer or Agent), I run `map check` and read, after the existing checks, coverage per area and the endpoints behind no capability.

- the header line: "coverage: N of M endpoints behind a capability"
- one line per area: endpoints the area's capabilities list, over the endpoints of the same resource or admin model; folded areas appear once, by their vocabulary name
- "first-party, behind no capability": every endpoint whose handler lives in a project file, by method and path, sorted
- "third-party, behind no capability": one count per package (allauth, hijack, admin); `map check --third-party` lists them one by one, by method and path
- "areas with no term": the derived areas the vocabulary has not named (UF20)
- "unnamed capabilities" (UF19)
- the exit code is unchanged by any of these lines

AAU (Agent), the summary I write after the map step carries the same block, and the map workflow ends when every first-party gap is behind a capability or listed in the summary with why it stays open.

AAU (reader), the page header shows "coverage N of M", linking to the Routes tab filtered on "behind no capability".

## Success Scenario

- AAU, on action-tracking after the refit, I read "coverage: 142 of 287", the first-party gaps named by path, and "third-party: 122 (allauth 66, hijack 2, admin 54)", with exit 0.
- AAU, on `fixtures/django-demo`, every endpoint is behind a capability: the gap lines are absent and the header says "coverage: M of M".

## Error Scenario

- AAU, a capability lists an endpoint the inventory no longer has: `map check` fails as today ("endpoint not found"), before the coverage block.

## Edge Cases

- AAU, an endpoint listed by two capabilities counts once.
- AAU, a HEAD row is covered by its GET's capability.
- AAU, an endpoint with a `nobody` who (disabled) is counted as covered by nothing and listed under first-party when its handler is first-party.

## Acceptance Criteria

- [ ] `map check` prints the coverage block on `fixtures/django-demo` and action-tracking; a CLI scenario asserts the lines.
- [ ] Coverage never changes the exit code; a scenario proves exit 0 with gaps.
- [ ] `--third-party` lists the third-party gaps; without it only the per-package counts print.
- [ ] `assets/summary-template.md` has the coverage block; the map workflow's completion criterion names it.
- [ ] The page header and the app header show coverage and link to the filtered Routes tab.
