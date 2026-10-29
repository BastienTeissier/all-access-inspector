# UF17: Decide a capability

**Notion ticket:** *(not requested)*

## Context

A partial capability (a role reaching the list of scanned cards but not its refresh endpoint, or the reverse) is either a bug or a way to leak data. Neither the inventory nor the map can tell which. A human has to decide it once, and the decision has to reopen when the code changes, like a Verdict.

## Specification

AAU (developer or security reviewer), I decide one cell, from the app (UF18) or with `node <skill>/map/src/cli.ts decide <project> <capability> <role> --verdict safe|accepted|finding --reason <text> [--severity] [--ticket] [--until]`. The decision is appended to `tools/access-inspector/reviews.jsonl` as a `decided` event:
- keyed by `[capability, role]`
- with the same verdicts and fields as a Verdict: `finding` requires a severity and may have a ticket, `accepted` may have an expiry date
- carrying what the cell was when decided: its state, the endpoints the role reached and the ones it did not, each with who passes and its basis

On replay, a decision is outdated when the cell's state or its reached and missed endpoints change, or when an `accepted` passes its date. An outdated decision puts the partial back under Alerts.

AAU, I ask the Agent to look at the map; when it thinks a cell is wrong it appends a `signal_raised` event on `[capability, role]`, shown under Alerts as "Agent suggests". It never appends a `decided` event.

AAU, I run `map check` in CI: it exits 1 on a partial capability with no decision or an outdated one, and lists open `finding` decisions without failing.

## Success Scenario

- AAU, on `fixtures/django-demo`, I decide the partial capability `accepted` with a reason, `map check` exits 0 and the cell shows the decision.
- AAU, I then remove the permission check from one of its endpoints, regenerate the inventory and the runtime, `map check` exits 1 and the partial is back under Alerts as outdated.

## Error Scenario

- AAU, I decide without a reason, or a `finding` without severity, nothing is written and the command exits 2.
- AAU, the capability or the role does not exist, the command exits 2 naming it.

## Edge Cases

- AAU, if a capability is renamed in the vocabulary, I see its decisions orphaned, as History shows orphaned Verdicts; they are never re-attached automatically.
- AAU, if I decide a cell that passes or does not pass, the decision is kept and shown; only partial cells need one.

## Acceptance Criteria

- [ ] A decision is one appended line, through the same append code as Verdicts; `merge=union` holds.
- [ ] Replay derives outdated and orphaned decisions; nothing is written to mark them.
- [ ] The Agent cannot append a `decided` event.
