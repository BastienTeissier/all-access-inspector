# UF20: Capabilities from resources, on every stack

**Notion ticket:** *(not requested)*

## Context

Runtime capabilities come from the Map Introspect, and only Django's exists; it reads admin pages. A plain API resource (`/api/actions/`, `/api/actions/{pk}/`) is behind no capability unless the Agent hand-writes one, so a NestJS, Spring or Symfony map starts empty and a Django API is a coverage gap. The inventory already describes every route on every stack; the map can derive a capability per resource and verb from the path shapes, with basis `inferred`.

## Specification

AAU (developer), I build the map of any supported stack and see one area per REST resource, with its capabilities derived from the inventory, without writing anything.

- a resource is a collection path with a detail sibling under the same prefix: `/api/actions/` and `/api/actions/{pk}/`
- its area is the last segment of the collection path; its term comes from the vocabulary `areas` entry only, and `map check` lists the areas still without one
- its capabilities are one per verb present: list (GET collection), read (GET detail), create (POST collection), update (PUT/PATCH detail), delete (DELETE detail); a nested path (`/api/actions/{pk}/duplicate/`) is a capability of its own named after its last segment
- every derived capability has basis `inferred` and `derived: "resource"`, the endpoints it lists are the inventory rows, and its check and `at` come from the join as for any capability
- an endpoint whose handler is third-party (a dotted name with no project file) is never derived from

AAU (Agent), through the vocabulary I rename a derived capability (`extends`), group several under one area, or replace them with a hand-written one (`replaces`); the replaced derived capability disappears from the matrix and the check.

## Success Scenario

- AAU, on `fixtures/django-demo`, `/api/orders/` yields "orders" with list, read, create, update, delete; on `fixtures/nestjs-demo`, `/users` and `/users/:id` yield "users" with the verbs its controller exposes.
- AAU, on action-tracking, "actions" and "action-plans" appear with their verbs; the curated `create-action` replaces the derived create, so it appears once.

## Error Scenario

- AAU, a path with a detail sibling under a different prefix (`/api/v1/actions/`, `/api/v2/actions/{pk}/`) yields two resources, one per prefix, and nothing is guessed across them.

## Edge Cases

- AAU, a collection path with no detail sibling (`/api/stats/`) is not a resource; it stays a gap listed by coverage.
- AAU, a detail path with two parameters (`/api/actions/{pk}/comments/{id}/`) is a resource under its own prefix, `actions.comments`.
- AAU, a derived capability's cell can be decided; its key is stable across builds as long as the path shape is.
- AAU, a Django admin model with both an admin area and an API resource keeps two areas unless the vocabulary groups them.

## Acceptance Criteria

- [ ] Derivation lives in `map/src/`, reads the inventory only, and runs on every stack the inventory supports.
- [ ] Unit tests cover the detail sibling, the prefix split, nested actions, third-party exclusion and `replaces`.
- [ ] `fixtures/*/expected` goldens include derived capabilities; `CONTEXT.md` defines "Derived capability".
- [ ] The Roles tab draws a derived capability with its `inferred` basis mark.
