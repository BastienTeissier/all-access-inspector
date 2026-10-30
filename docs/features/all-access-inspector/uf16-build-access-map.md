# UF16: Build the access map

**Notion ticket:** *(not requested)*

## Context

The inventory says, per endpoint, whether a sign-in and an authorization check exist. It does not say which roles pass, what a role can do in the domain's words, or how far its reach goes over the records. A reviewer asking "what can a QHSE Manager do with scanned cards?" reads code. The access map answers per role and per capability, and every answer says where it was read and how far to trust it.

## Specification

AAU (developer or security reviewer), in a project with a Committed Inventory, I ask the all-access-inspector skill for the access map. The Agent:
- vendors the stack's Map Introspect when the stack has one (Django today) into `tools/access-map/`, and fills its project section with Map Rules: `roles()`, `includes()`, `grants()`, `scopes()`, `capabilities()`, each fact with its `file:line`; it shows me every Map Rule with its evidence before saving, as when fitting
- reads roles from the code: groups and their grants, the superuser bypass, what the sign-in assigns; on NestJS the `Role` enum behind `@Roles()`, on Spring `ROLE_*` and `hasRole`, on Symfony `role_hierarchy`; it gives each role a kind (`signed_in`, `superuser`, `group`) from evidence, and adds no role the code does not define
- maps each role and each area to the project's docs: `CONTEXT.md` when it exists, else the README or `docs/`, else the defining model or class, always with a `file:line`; a role the docs name and the code does not, or the reverse, is reported to me
- writes `tools/access-map/vocabulary.json` with me, only for what no program can read: capability names in the glossary's words, endpoints one action spans, capabilities outside any pattern, scopes not read by a rule, checks inside handler bodies; each entry gives the reason it was not extracted
- runs `map pin`, `map check` and `map build`, and prints the coverage ("N of M endpoints behind a capability"), the partial capabilities, and on a stack with no introspect the facts it saw a readable pattern for ("could be extracted")

The introspect writes `tools/access-map/runtime.json` deterministically: same commit, same bytes.

AAU, I run `node <skill>/map/src/cli.ts build <project>` and open the static page it writes (`tools/access-map/out/access-map.html`, ignored by git). I see four tabs:
- **Alerts**: partial capabilities with no valid decision, capability decisions with an open `finding`, endpoints behind no capability, the Agent's suggestions, the review Signals (all seven named) and the endpoints outside their expected access
- **Roles**: areas × roles; each cell shows passes, partial, does not pass, switched off or not resolved, its scope, and its basis as a border (solid read from the code, ≈ inferred, dotted ✎ hand-written, dashed not resolved); clicking a cell shows the check, the evidence, the endpoints the role reaches and the ones it does not
- **Routes**: one row per endpoint with who passes, the chain of checks, and filters
- **How it's built**: what each source contributed and every heuristic behind an inferred badge

## Success Scenario

- AAU, on `fixtures/django-demo`, I build the map, I see every role the fixture defines and only those, the admin model actions as capabilities with their endpoints, and one partial capability raised under Alerts.
- AAU, on moi, I build the map, I see the groups from the grants, the not signed in column first and the superuser last, User included in every account with its `file:line`, and no role from the workflow that the code does not check.

## Error Scenario

- AAU, a pinned `file:line` no longer shows its line, `map check` and `map build` exit 1 listing each one and where the line moved.
- AAU, the vocabulary writes a role, grant, scope or capability that a Map Rule already produces, `map check` exits 1 naming both.
- AAU, the vocabulary is not valid against `schema/vocabulary.schema.json`, or a role has a kind outside the three, the command exits 2 naming the field.
- AAU, `runtime.json` lists an endpoint the inventory does not, or the reverse, `map check` exits 1 naming them.

## Edge Cases

- AAU, if the stack has no introspect, I see an empty runtime, every fact hand-written (dotted ✎), and the "How it's built" tab saying so.
- AAU, if the project has no `CONTEXT.md`, I see each area's term marked "from the code" with its `file:line`, and the summary proposes starting a `CONTEXT.md`; the Agent does not write it.
- AAU, if a role passes only through a check decided in code the map cannot resolve, I see the cell not resolved (dashed), never as passing.
- AAU, if the project makes every account staff, I see staff checks passing for every signed-in role, with the evidence the introspect read.

## Acceptance Criteria

- [ ] No role, scope or area name is hard-coded in the toolkit; not signed in is the only role it adds.
- [ ] Whether a role passes a capability is computed; only scopes, names and groupings are hand-written, each with its reason.
- [ ] `runtime.json` is byte-stable and `introspect.py --check` exits 1 when it differs from the committed one.
- [ ] The static page holds no access logic: it draws the data `map/src/` computes.
