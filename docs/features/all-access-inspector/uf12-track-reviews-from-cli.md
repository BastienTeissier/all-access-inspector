# UF12: Track reviews from the command line

**Notion ticket:** *(not requested)*

## Context

A fitted project like moi has 514 endpoints. The Committed Inventory says what each endpoint enforces, not whether that is right for what it does. A reviewer needs to record a Verdict per endpoint, see which endpoints still need one and in which order, and keep that record with the code. This UF delivers the Review Log and the command line over it; the app (UF14) and the agent (UF13) build on it.

## Specification

AAU (developer or security reviewer), from a checkout of the toolkit, I run `review status <project>` on a project that has `tools/access-inspector/inventory.json`. It never boots the application and never runs git. I see:
- a header with the inventory's stack, coverage, endpoint count, and counts of valid, outdated and orphaned Verdicts
- the Review Queue: every endpoint without a valid Verdict, grouped by tier, highest first, then path and method; each line shows method, path, zone, authentication/authorization, and every Signal it carries
- the tiers, in this fixed order:
  1. open `finding`
  2. outdated Verdict
  3. outside its zone's expected access
  4. Acknowledged Unknown
  5. sibling inconsistency
  6. anonymous or optional, unsafe method (POST, PUT, PATCH, DELETE, ANY)
  7. open agent Signal
  8. required, authorization none, path with a parameter
  9. anonymous or optional, safe method
  10. other required with authorization none
  11. authorization `rule`
- the orphaned Verdicts, with their last verdict and reason

AAU, I run `review append <project> --verdict safe|accepted|finding --reason "<text>" <METHOD> <path>` and one `reviewed` event is appended to `tools/access-inspector/reviews.jsonl`, carrying my `git config user.email`, the date, the Review Key and the classification the endpoint has now. `--severity low|medium|high` and `--ticket <url>` are required/optional for `finding`; `--until <date>` is optional for `accepted`.

Rules applied on replay:
- Review Key: method, path, handler with any `:line` stripped.
- The latest valid event for a key wins (by date, then by line order).
- A Verdict is **outdated** when the endpoint is inside its expected access and its authentication or authorization value differs from the reviewed one; when it is outside its expected access and any of authentication value, authorization value, layer, raw or rule differs; or when an `accepted` Verdict is past its `until` date. A project with no expected access for the endpoint's zone uses the first rule.
- A Verdict is **moot** when the reviewed classification was outside expected access and the endpoint is now inside it; moot Verdicts stay valid.
- A Verdict is **orphaned** when its key matches no endpoint.
- A **sibling inconsistency**: two endpoints sharing a handler, or whose paths differ only by a trailing parameter segment (`/observations/` and `/observations/{id}/`), with a different authentication or authorization value, unless both values come from the same rule.

## Success Scenario

- AAU, on moi with an empty Review Log, I see 514 endpoints in the queue, none in tiers 1 and 2, the anonymous POST endpoints in tier 6 and the 378 `rule` endpoints in tier 11.
- AAU, I append `safe` on `GET /perseus/api/body-part-tree/` with a reason, then run `status`, I see it out of the queue and one valid Verdict in the header.
- AAU, after a change makes that endpoint `anonymous`, I see it in tier 2 with "was required/none, now anonymous/none".
- AAU, a class moves from `view.py:27` to `view.py:31`, I see its Verdicts still valid.

## Error Scenario

- AAU, the project has no `inventory.json`, I see "fit the project first" and exit 2.
- AAU, I append on a method and path that are not in the inventory, I see it refused and nothing is written.
- AAU, I append without `--reason`, or a `finding` without `--severity`, I see it refused and nothing is written.
- AAU, a line of `reviews.jsonl` is not a valid event (a merge marker, a bad field), I see the line number and what is wrong, and exit 2.

## Edge Cases

- AAU, if a HEAD endpoint has the same classification as its GET, appending on the GET also appends on the HEAD.
- AAU, if two branches each appended a Verdict on the same endpoint and were merged, I see the later one win.
- AAU, if `reviews.jsonl` does not exist, `status` treats the log as empty and `append` creates it.
- AAU, if a handler moves to another file, I see the old Verdict orphaned and the endpoint back in the queue.

## Acceptance Criteria

- [ ] `status` on the same inventory and log prints the same output on any machine.
- [ ] Each tier and each Signal is covered by a test on a fixture inventory.
- [ ] Outdated, moot and orphaned states follow the rules above, each tested.
- [ ] `append` validates the endpoint, the verdict and its required fields before writing, and only ever appends.
- [ ] Every event carries a schema version; an event with an unknown version is reported, not guessed.
- [ ] The Base Scripts and Adapted Scripts are unchanged.
