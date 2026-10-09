# UF5: Update an existing fitting

**Notion ticket:** *(not requested)*

## Context

A project already has an Adapted Script. New code introduced an `unknown`, the Base Script has a newer version, or the boot broke. The developer re-runs the skill and expects their existing rules and decisions to survive.

## Specification

AAU (developer), invoking the skill in a repository that already has `tools/access-inspector/`, I see the Agent:
- detect the existing Adapted Script and enter update mode instead of starting over
- keep every existing Recognition Rule, Acknowledged Unknown, boot decision and Project Dimension unless its evidence no longer exists
- run the script and work only on new unknowns and on rules whose evidence moved or disappeared
- optionally refresh the vendored Base Script files to the toolkit's current version when I ask, re-applying my rules on top
- commit on a branch with a summary limited to what changed

## Success Scenario

- AAU, a teammate added an `IsProjectMember` permission class, I see one new Recognition Rule citing it and nothing else changed.
- AAU, a cited decorator was moved to another file, I see the rule's evidence updated and the rule kept.
- AAU, I ask for a Base Script refresh, I see the vendored files updated, my `rules.py`, `boot.py` and `dimensions.py` preserved, and `--check` passing.

## Error Scenario

- AAU, a rule's evidence no longer exists and the construct is gone, I see the rule removed and the summary says why.
- AAU, the boot fails after a settings refactor, I see the Agent fix `boot.py` under the same toward-production rule, without touching existing rules.

## Edge Cases

- AAU, if I prefer to fix an unknown by hand, I edit `rules.py`, regenerate, and commit; the Adapted Script is readable enough that no Agent is needed.
- AAU, if I prefer to acknowledge rather than map, I write the reason in `rules.py` and the inventory shows it.
- AAU, if the Base Script refresh changes a built-in rule's outcome, the inventory diff shows each affected endpoint so the reviewer sees the toolkit change, not only the code change.

## Acceptance Criteria

- [ ] Update mode on an unchanged project produces no diff.
- [ ] A new custom construct produces exactly one new Recognition Rule and no other change.
- [ ] Existing rules, unknown reasons, dimensions and boot decisions are byte-identical after an update that does not concern them.
- [ ] A Base Script refresh preserves the project-specific files and passes `--check` after regeneration.
