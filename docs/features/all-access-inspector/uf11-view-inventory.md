# UF11: View the inventory

**Notion ticket:** *(not requested)*

## Context

The Endpoint Inventory is JSON written for machines and diffs. A developer or a reviewer needs to see, at a glance, what needs a human and whether each endpoint's checks match the team's intent, without reading JSON or running the project.

## Specification

AAU (developer or reviewer), I open the viewer shipped with the skill in a browser and load a project's `inventory.json` (file picker or drag-and-drop). Nothing is sent anywhere and nothing needs to be installed. I see:
- a header with the stack, Base Script version, coverage and boot entry
- **Triage**: endpoints in buckets, worst first: can't tell, acknowledged, open to anyone, sign-in optional, role required, sign-in required; each with one sentence saying why
- **Zones**: endpoints grouped by the values of a Project Dimension; an endpoint whose classification is outside the team's expected access for its value is flagged
- on click, a detail panel: the request going through each layer (global, class, method) to the handler, the check deciding each axis, its rule and the `file:line` evidence

HEAD rows identical to their GET row are shown as one endpoint.

## Success Scenario

- AAU, I load the nestjs-demo inventory, I see "can't tell" first, with `/legacy/status` and its reason; in Zones `access_tier`, `/api/admin/users/stats` is flagged: staff expects a role, any signed-in user gets in.
- AAU, I click `GET /api/admin/users`, I see `SessionGuard` at global (rule `session`, `src/auth/session.guard.ts:8`) and `RolesGuard roles=["admin"]` at class (rule `roles`).

## Error Scenario

- AAU, I load a file that is not an Endpoint Inventory, I see what is wrong and the viewer stays usable.

## Edge Cases

- AAU, the inventory has no Project Dimension, I see the Zones tab say so.
- AAU, a dimension has no expected access, I see its zones without flags.
