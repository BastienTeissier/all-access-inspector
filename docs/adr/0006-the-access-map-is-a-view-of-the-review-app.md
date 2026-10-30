# The access map is a view of the review app, and its decisions go in the Review Log

A partial capability (a role reaching some of a capability's endpoints) is a possible leak until a human decides it, and that decision must survive the browser, be shared, and reopen when the code changes. The moi prototype was a static page with sign-off marks in `localStorage`. We decided that the map is a set of pages of the review app, that a Capability Decision is a Review Log event keyed by capability and role, and that `map build` keeps exporting a read-only static page for sharing.

## Considered options

- **Static page only, decisions in `localStorage`**: rejected. Lost with the browser, never shared, blind to drift.
- **A separate decision log next to `runtime.json`**: rejected. A second log means a second replay, a second merge rule and a second history; ADR 0004 already gives one.
- **Retire the static page**: deferred. Sharing a map as one file is still wanted; both are kept, and both draw the same data.

## Consequences

- All access logic (reach, cell state, scope, basis, alerts) lives in `map/src/` and is unit-tested; the app pages and `page.html` only draw it, and a test checks they agree.
- A Capability Decision uses a Verdict's words and fields (`safe`, `accepted` with `until`, `finding` with severity and ticket) and carries a fingerprint of the cell; replay makes it outdated when the fingerprint changes.
- `map check` exits 1 on a partial capability with no decision or an outdated one, so CI catches new partials like it catches inventory drift.
