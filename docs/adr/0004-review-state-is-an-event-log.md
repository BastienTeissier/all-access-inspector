# Review state is an append-only event log committed with the inventory

Reviewers need to record, per Endpoint, whether its access is correct, with a history of who decided what and why, and a review app will later hold other metrics (CVEs, web vitals). We decided that review events are appended to `tools/access-inspector/reviews.jsonl`, committed next to the Committed Inventory, and that any database is a projection rebuilt from it.

## Considered options

- **SQLite as the store**: rejected. Committed, it is a binary diff nobody can review and two branches cannot merge; uncommitted, it lives on one machine and CI never sees it.
- **A sorted JSON file of current verdicts**: rejected. It keeps no history beyond `git log`, and two reviewers editing the same records conflict.
- **A hosted app writing to the repositories**: deferred. It needs write tokens to every audited repository; a later hosted app aggregates committed logs read-only.

## Consequences

- History is the file itself; appends merge with `merge=union` and a PR diff is pure additions, so the PR review is the trust gate for verdicts.
- Outdated and orphaned verdicts are derived on replay against the current inventory, never written.
- The review logic (schema, replay, signals, tiers) lives once in a TypeScript package used by the app, the CLI and the skill; Base Scripts stay untouched.
- The app's SQLite is disposable; deleting it loses nothing.
