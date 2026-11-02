# UF22: Alerts that stay short

**Notion ticket:** *(not requested)*

## Context

On action-tracking the Alerts tab counts 196 and opens on 145 endpoints "behind no capability", most of them third-party sign-in routes; the same endpoint can appear three times (uncovered, "Outside its expected access" signal, outside-expected). Review signals belong to the review queue; the map lists what only the map can raise.

## Specification

AAU (reviewer), I open the Alerts tab and see, in this order, only what the map raises, each endpoint or cell at most once.

- "Partial, not decided": every partial cell with no decision (opened by default when present)
- "Findings": every cell decided `finding`, with severity and ticket
- "Not resolved": every cell in `open` state, with the custom check it waits on
- "Coverage": one line per area with first-party gaps, with a count linking to the Routes tab filtered on that area and "behind no capability"; one line for third-party handlers with their count
- "Review queue": one line, "N signals on these endpoints", linking to the queue; no signal is listed here
- the tab's count is the sum of the first three groups; coverage and the queue line carry their own counts, out of the tab's
- an endpoint appearing under coverage never appears elsewhere on the tab; an endpoint carrying a signal is counted in the queue line only

AAU (reader), the static page and the app show the same groups and counts.

## Success Scenario

- AAU, on action-tracking, the tab reads 0, opens on Coverage, lists four area lines and one third-party line, then "Review queue: 50 signals".
- AAU, on `fixtures/django-demo` with one partial decided `finding`, the tab reads 1 and opens on Findings.

## Error Scenario

- AAU, the Review Log is missing or unreadable: the tab shows the map's groups and "Review queue: unavailable", as the queue page would.

## Edge Cases

- AAU, a project with no gap and no signal shows the first three groups only, empty, and no Coverage or Review queue line.
- AAU, a partial cell on a derived capability (UF20) is listed like any other partial.
- AAU, a `nobody` endpoint raises nothing: it is neither a gap nor an alert.

## Acceptance Criteria

- [ ] `ALERT_KINDS` holds `undecided`, `finding`, `open`; coverage and the queue count are separate fields of the built map.
- [ ] A unit test proves no endpoint key appears twice across the tab's data.
- [ ] The static page and the app render the same groups from the same `map/src/` output; a Playwright scenario checks the order and the counts.
- [ ] The queue line links to the review queue filtered on the inventory's endpoints with a signal.
