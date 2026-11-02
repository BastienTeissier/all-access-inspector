# Derived facts come from the inventory, the same rule on every stack

Most first-party endpoints of an API sit behind no extracted capability: a Map Introspect reads the admin, not the REST views, and a stack with no introspect reads nothing. Yet a REST resource says what it does in its path shape: a collection `<prefix>` with a detail sibling `<prefix>/{param}` is listed, read, created, updated and deleted. We decided that the map derives one capability per resource and verb (and one per action nested under a detail path) from the inventory, in `map/src/resources.ts`, with basis `inferred`. Only first-party handlers are derived from, and the rule is the same on every stack.

## Considered options

- **Each Map Introspect writes resource capabilities into `runtime.json`**: rejected. The rule reads only paths and methods, which the inventory already holds on every stack; writing it per introspect repeats it four times, leaves a stack with no introspect (NestJS, Spring, Symfony today) with none, and lets the copies drift apart.
- **The Agent proposes them in the vocabulary**: rejected. A rule a program can apply is not curation; hand-written entries would go stale with every new route and cost a review each time.

## Consequences

- A derived capability is replaced like an extracted one: a hand-written capability's `replaces` drops it, and `extends` names it. Its id is `resource.<prefix slug>.<verb>` (`resource.api.invoices.list`), so `/v1/items` and `/v2/items` stay distinct.
- Its name is the verb and the path segment as is (`List invoices`, an action's segment capitalised: `Refund`), so it never shows in the unnamed list; its area is the prefix slug, which shows under "areas with no term" until the vocabulary folds or names it. Coverage reports what derivation covers and never fails the check.
- `CONTEXT.md`'s ladder for where a capability comes from gains a rung: extracted, then derived, then named or hand-written by the Agent.
- A path whose shape is not plain segments and parameters (Symfony's `.{_format}`) is not derived.
