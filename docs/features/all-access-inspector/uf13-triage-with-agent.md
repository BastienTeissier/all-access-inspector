# UF13: Triage the inventory with the Agent

**Notion ticket:** *(not requested)*

## Context

Deterministic Signals see only the inventory's facts. Some risks show only in the handler: an anonymous CSV export, a `required/none` view whose queryset is not filtered by the user, a POST reserved to staff beside a PUT open to every signed-in user on a handler the tiers did not pair. The Agent can read handlers and point at them, but it is not deterministic, so its output only reorders the queue; it never decides.

## Specification

AAU (developer or security reviewer), in a project with a Committed Inventory, I invoke the all-access-inspector skill and ask it to triage the inventory. The skill:
- runs `review status` to get the queue
- reads the handler of every endpoint that has no valid Verdict, is not decided by an authorization `rule` alone (the last tier: a rule and no other Signal), and has no `triaged` or `signal_raised` event valid for its current classification
- follows the stack reference's triage checklist: the handler's name and verb against its guard; checks in the body the inventory cannot see (`request.user`, `PermissionDenied`, a queryset filter); bulk or export responses; writes on anonymous endpoints
- appends, through `review append --agent`, one event per endpoint read: `signal_raised` with a one-line reason and the `file:line` it read, or `triaged` when it found nothing; all events of one run share a batch id and `by` is `agent:<model id>`
- prints a summary: endpoints read, Signals raised with their reasons, and endpoints skipped with why

It never appends a Verdict, never edits the inventory or the Adapted Script, and never commits.

AAU, I run `review status` after a triage, I see endpoints with an agent Signal in tier 7 labelled "suggested by the agent", and triaged endpoints with no Signal keeping their tier with an "agent: no signal" mark.

## Success Scenario

- AAU, on moi, the first triage reads 110 rows (33 project handlers, plus third-party ones it skips); a second triage with no code change reads none.
- AAU, a triaged endpoint later changes classification, the next triage reads it again.

## Error Scenario

- AAU, the project has no Committed Inventory, I see the skill tell me to fit it first.
- AAU, `review append --agent` is called with `--verdict`, I see it refused.

## Edge Cases

- AAU, if a handler is third-party (a dotted name with no project file), the skill reads the project line that mounts it, or skips it and says so.
- AAU, if I name endpoints or a path prefix, only those are triaged.
- AAU, if an agent Signal's endpoint later gets a human Verdict, the Signal no longer counts in the queue.

## Acceptance Criteria

- [ ] SKILL.md has a Triage section; each stack reference has a triage checklist.
- [ ] `append --agent` accepts only `signal_raised` and `triaged`, and stamps `by` as `agent:<model id>`.
- [ ] Agent events go outdated by the same rules as Verdicts.
- [ ] A triage run never changes anything outside `reviews.jsonl`, and `.gitattributes` on the first run in a project.
