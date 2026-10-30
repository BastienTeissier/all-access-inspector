# Access facts are read from the code before anyone writes them by hand

The access map needs roles, grants, scopes, role inclusions and capabilities for every project, on every stack. The Agent can write any of them by hand, but a hand-written fact drifts silently, and the toolkit exists to catch access drift. We decided that a fact the code declares in a form a program can read (a dict, an enum, a config file, an annotation, a filter used the same way every time) is read by a Map Rule in the Map Introspect, with its `file:line`; the Map Vocabulary holds only what no program can read, each entry with the reason it was not extracted.

## Considered options

- **Everything in the vocabulary, written by the Agent with the user**: rejected. It was the moi prototype; its role grid could say a group passes while the routes it was about let only superusers through, and nothing compared the two.
- **A generic role list shipped by the toolkit** (anonymous, signed in, staff, superuser): rejected. Roles are the project's; a generic list hid that moi makes every user staff, and would invent a superuser on a stack that has none.
- **The Agent improvises an introspect for a stack without one**: deferred. Facts on such a stack are hand-written and listed as "could be extracted", one concrete item per missing introspect.

## Consequences

- Every badge carries a Basis, and the page draws it: solid when read, ≈ inferred, dotted ✎ hand-written, dashed not resolved. A cell takes the weakest basis it rests on.
- The Map Runtime is committed and byte-stable, checked in CI like the inventory, so a change in who passes is a reviewable diff.
- `map check` refuses a hand-written entry that a Map Rule already produces.
- Whether a role passes a capability is computed, never written; only its scope is hand-written, with evidence.
