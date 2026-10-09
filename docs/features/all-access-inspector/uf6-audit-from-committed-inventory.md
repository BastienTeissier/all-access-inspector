# UF6: Audit from the Committed Inventory

**Notion ticket:** *(not requested)*

## Context

A security auditor runs the security-audit skill on a project that has a Committed Inventory. The audit should start from the inventory's facts, on any stack, without booting the application.

## Specification

AAU (auditor), running the security-audit skill on a project with `tools/access-inspector/inventory.json`, I see:
- a new scanner reference `access-inspector.md` replacing the Django-specific one, which reads the Committed Inventory and never runs the application
- a parse script producing a summary (endpoint counts per authentication and authorization value, per layer, per Project Dimension value) and the list of endpoints that are `anonymous`, `optional` with no authorization rule, or `unknown`
- the audit report classifying those endpoints by risk after reading the handlers, with recommendations, in the existing report template
- the `discovery_mode` and `coverage` of the inventory stated at the top of the report, so a `best-effort` inventory is not mistaken for a complete one

## Success Scenario

- AAU, the inventory has three `anonymous` endpoints under `/api/`, I see them listed first with the handler location and a risk classification after the skill read the handlers.
- AAU, the inventory is `coverage: complete` with zero unknown, I see "No unexplained endpoints" and the audit focuses on `anonymous` and `optional` ones.

## Error Scenario

- AAU, there is no Committed Inventory, I see the skill tell me to fit the project with all-access-inspector first; it does not attempt a boot.
- AAU, the Committed Inventory is stale (`--check` would fail), I see a warning and the audit proceeds on the committed facts, naming the staleness.

## Edge Cases

- AAU, if the repository has several Adapted Scripts, I see one section per application.
- AAU, if an endpoint is an Acknowledged Unknown, I see its reason quoted and it is not counted as a finding unless the handler read contradicts the reason.

## Acceptance Criteria

- [ ] The parse script works on inventories from any stack using only schema fields.
- [ ] The report states discovery mode and coverage.
- [ ] Acknowledged Unknowns appear with their reasons and are distinguished from unexplained ones.
- [ ] The Django-specific reference and parse script are removed from the security-audit skill.
