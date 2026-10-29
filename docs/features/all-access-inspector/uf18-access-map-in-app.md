# UF18: Read and decide the access map in the review app

**Notion ticket:** *(not requested)*

## Context

The static page can be shared but cannot write. Deciding partial capabilities and following a leaking endpoint to its Verdict happen where the reviewer already works: the review app.

## Specification

AAU (developer or security reviewer), I run `review app <project>` and open the map from the header. I see the same four tabs as the static page (UF16), built from the same data, refreshed when the inventory, the runtime, the vocabulary or the Review Log change outside the app. Filters are URL parameters, as in the queue.

- clicking a cell opens a panel with the check, the evidence, the endpoints the role reaches and the ones it does not, the cell's decision history, and a decision form sharing the Verdict form's fields (UF17)
- clicking an endpoint opens the existing endpoint panel, so I can give a Verdict on the endpoint that leaks
- saving a decision appends one `decided` event and selects the next undecided partial
- History lists decisions beside Verdicts, grouped by batch, with orphaned decisions

## Success Scenario

- AAU, on `fixtures/django-demo`, I open the partial cell, decide it `finding` severity `high` with a ticket, I see it under Alerts as an open finding and "1 event not committed".
- AAU, I open the static page built from the same files, I see the same cell states and the same alert count.

## Error Scenario

- AAU, I save a decision without a reason, or a `finding` without severity, I see the field flagged and nothing is written.
- AAU, the vocabulary is stale or invalid, I see what `map check` would print and the last good map stays displayed.

## Edge Cases

- AAU, if the project has no `tools/access-map/`, I see the map entry disabled with what to ask the Agent.

## Acceptance Criteria

- [ ] The app writes only `reviews.jsonl`, only by appending.
- [ ] The app pages compute no access logic; they draw what `map/src/` returns.
- [ ] Cell states and alert count match between the app and the static page for the same files.
