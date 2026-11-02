# UF23: The skill split by branch

**Notion ticket:** *(not requested)*

## Context

`SKILL.md` carries the fit, update, triage and map workflows in one 3,600-word file; a triage run loads the fit and the map it does not need. Its description carries body text, the "Stack terms" table repeats each reference's "Vendor and run", and the hard rules on committing, Verdicts and the inventory are stated up to three times. The writing-for-agents principles apply: one source per fact, progressive disclosure by branch, a completion criterion per step, prohibitions paired with their positive rule.

## Specification

AAU (Agent), when the skill is invoked I read `SKILL.md`, which holds the detection of the stack, the hard rules, and a router to the one workflow I need; I then read that workflow and the stack reference.

- `SKILL.md`: the description names the four triggers only (fit a project, update a fitting, triage an inventory, build or read the map); the body holds stack detection, the hard rules once each, and the router with its four branches and their entry conditions
- `workflows/fit.md`: steps 1 to 8 with their completion criteria, ending on the summary
- `workflows/update.md`: the update mode
- `workflows/triage.md`: the triage, ending on the triage closing
- `workflows/map.md`: the map steps, ending on the coverage and naming criteria (UF19, UF21)
- each hard rule is written in one place, as a positive rule with its prohibition beside it ("The Agent commits on a branch and stops; pushing and merging belong to the user")
- stack facts (vendor, run, triage checklist, map introspect) live in `references/<stack>.md` only; `SKILL.md` and the workflows point to them

AAU (reader of the skill), the README and `test.md` scenarios still describe the same behaviour; the file paths they name exist.

## Success Scenario

- AAU, invoking the skill to triage `fixtures/django-demo` loads `SKILL.md`, `workflows/triage.md` and `references/django.md`, and the triage runs as in `test.md`.
- AAU, each of the four branches runs on `fixtures/django-demo` with the same outcome as before the split.

## Error Scenario

- AAU, on an unsupported stack, `SKILL.md` routes to `references/unsupported.md` and the fit workflow, as today.

## Edge Cases

- AAU, a run that starts in fit and continues into map reads both workflow files, in that order; `fit.md` ends by pointing at `map.md`.
- AAU, a hard rule needed by every branch stays in `SKILL.md`; one needed by a single branch moves into that workflow.

## Acceptance Criteria

- [ ] `SKILL.md` is under 1,200 words; the description under 40.
- [ ] A grep for each hard rule's key phrase finds it in one file.
- [ ] No table in `SKILL.md` or a workflow restates a reference's "Vendor and run".
- [ ] The docs-consistency skill passes on the paths and commands the files name.
- [ ] The four `test.md` scenarios run unchanged.
