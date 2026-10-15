# UF15: Review in bulk and read the history

**Notion ticket:** *(not requested)*

## Context

On moi, 378 endpoints are Django admin views guarded by one Recognition Rule; reviewing them one by one is pointless. Reviewers also need to see who decided what and why, and to recover reasons when an endpoint is renamed or moved and its Verdict is orphaned.

## Specification

AAU (developer or security reviewer), in the app's Queue, with a filter applied, I choose **Review selection**. I see:
- the number of endpoints the filter selects now, and a sample of them
- the Verdict form of UF14, with one reason for the batch
- on save, one `reviewed` event per selected endpoint, all sharing one batch id

AAU, I open **History**. I see:
- events grouped by batch, newest first: who, when, verdict or event type, reason, endpoint count, expandable to the endpoints
- agent triage runs as batches by `agent:<model id>`
- the orphaned Verdicts with their last verdict, reason and old Review Key

AAU, I open an unreviewed endpoint whose path or handler file matches an orphaned Verdict, I see that orphan proposed in the panel and can copy its reason into the Verdict form; saving writes a new `reviewed` event on the new key, and the orphan stays in history.

## Success Scenario

- AAU, on moi, I filter zone `user` and tier 11, review the selection as `safe` with "Django admin, is_staff through admin_site; staff_member_required at moi/views.py:11", I see 378 endpoints leave the queue and one batch in History.
- AAU, `/perseus/api/foo/{id}` was renamed `/perseus/api/foos/{id}`, I open the new endpoint, copy the orphan's reason, save, I see it reviewed and the orphan still in History.

## Error Scenario

- AAU, the selection is empty, I see the action disabled.
- AAU, the selection includes an endpoint with an open `finding`, I see it named and I must confirm before the batch replaces that finding.

## Edge Cases

- AAU, if an endpoint is added to the inventory after a batch, it is not covered by it and appears in the queue.
- AAU, if the selection exceeds 50 endpoints, I see the count repeated in the confirmation.

## Acceptance Criteria

- [ ] A bulk review writes one event per endpoint selected at save time; no event ever names a selector.
- [ ] History groups by batch id and shows agent runs.
- [ ] Orphan candidates are matched by path or handler file only, and copying never re-attaches the orphan.
