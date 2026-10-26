# UF14: Review endpoints in the app

**Notion ticket:** *(not requested)*

## Context

The command line works for a few verdicts, not for working down a queue of hundreds of endpoints. The reviewer needs to see the queue, open an endpoint with everything needed to judge it, and give a Verdict in a few seconds, on their own machine, with the result landing in the Review Log they will commit.

## Specification

AAU (developer or security reviewer), I run `review app <project>` from a checkout of the toolkit and open the local address it prints. I see:
- a header with the project, stack, coverage, valid/outdated/orphaned counts, and "N events not committed" when `reviews.jsonl` has changes git does not have
- **Queue**: the Review Queue by tier, as in UF12; each row shows method, path, zone, authentication/authorization, Signal badges (deterministic and agent), and its Verdict state (none, outdated); filters by zone, tier, Signal and Verdict state, and a path search; a "reviewed" view lists endpoints with a valid Verdict
- on click, an **endpoint panel**: the full classification per axis (value, layer, raw, rule, evidence), the endpoint's siblings whose access differs, with their classifications, its Signals with reasons, its event history, and links opening the handler and the evidence at their line in the editor
- a **Verdict form** in the panel: `safe`, `accepted` or `finding`; a reason, required; severity, required for `finding`, and a ticket URL, optional; an expiry date, optional for `accepted`; saving appends one `reviewed` event, as `append` does, and the endpoint leaves the queue or moves to tier 1

The app reflects changes to `inventory.json` or `reviews.jsonl` made outside it (a regeneration, a git pull) without restarting. It never writes through git: it only reads it, to count the events not committed yet.

## Success Scenario

- AAU, on moi, I filter tier 8, open `GET /perseus/api/body-part-tree/`, follow the handler link, save `safe` with "queryset filtered by request.user, moi/api/body_part_tree/view.py:40", I see the next tier-8 endpoint selected and "1 event not committed".
- AAU, I save a `finding` with severity `high`, I see the endpoint at the top of the queue in tier 1.

## Error Scenario

- AAU, I save without a reason, or a `finding` without severity, I see the field flagged and nothing is written.
- AAU, the inventory or the log cannot be read, I see what is wrong and the last good state stays displayed.

## Edge Cases

- AAU, if the endpoint has an outdated Verdict, I see the reviewed classification beside the current one, and the previous reason prefilled.
- AAU, if a HEAD endpoint matches its GET, I see them as one row and one save writes both events.
- AAU, if the project has no Project Dimension, I see no zone filter and no zone column.

## Acceptance Criteria

- [ ] The app writes only to `reviews.jsonl`, only by appending, through the same code as the CLI.
- [ ] Queue order and states match `review status` for the same files.
- [ ] Deleting the app's local database loses nothing; it is rebuilt from the files.
- [ ] The app listens on localhost only and needs no account.
