# Access Inspector — {{project}} ({{mode: fit | update}})

Branch `{{branch}}`, commit `{{sha}}`. Base Script {{stack}} {{version}}. Discovery {{discovery_mode}}, coverage {{coverage}}.

## Endpoints

| | anonymous | optional | required | unknown |
|---|---|---|---|---|
| authorization none | {{n}} | {{n}} | {{n}} | {{n}} |
| authorization rule | {{n}} | {{n}} | {{n}} | {{n}} |
| authorization unknown | {{n}} | {{n}} | {{n}} | {{n}} |

{{total}} endpoints; {{unknown}} unknown, each with a reason.

## Boot decisions

- Entry `{{production entry}}`: {{why it is the one production runs}}
- Stub `{{target}}`: {{reason}}
- Pin `{{setting}} = {{value}}`: {{reason}}
- Env `{{name}} = {{value}}`: {{reason}}

## Recognition Rules

- `{{name}}` ({{construct or path_prefix}}) → authentication {{authn}}, authorization {{authz}}; evidence `{{file:line}}`; {{endpoint count}} endpoints

## Acknowledged Unknowns

- {{construct or path}}: {{reason}}; {{endpoint count}} endpoints

## Project Dimensions

- `{{dimension}}`: {{value}} ({{n}}), …; confirmed by the user {{as proposed | with changes}}
- Expected access: `{{value}}` → authentication {{list}}, authorization {{list}}; …
- Outside their zone: {{none | `METHOD path` (value): {{what differs}}, …}}

## Update mode only

- Removed rules: `{{name}}`: {{why the evidence is gone}}
- Moved evidence: `{{name}}`: `{{old}}` → `{{new}}`
- Base Script refresh: {{old}} → {{new}}; endpoints whose classification changed: {{list}}

## Access map (when asked for it)

- Map Introspect: {{vendored at Base Script version | none for {{stack}}: every fact hand-written}}
- Map Rules: `{{rule}}()` → {{n}} facts; evidence `{{file:line}}`; …
- Roles: {{name}} (`{{id}}`, {{kind}}, `{{at}}`, docs `{{doc_at | from the code}}`), …
- Docs mismatches: {{none | role in the docs and not in the code, or the reverse}}
- Vocabulary: {{n}} entries, each with its reason; {{n}} anchors pinned
- Coverage: {{covered}} of {{total}} endpoints behind a capability
- Partial capabilities to decide: {{none | capability for role, …}}; decide each with `node {{skill}}/map/src/cli.ts decide` or in the review app
- Could be extracted: {{none | fact, where the code declares it}}
- See it: `{{project}}/tools/access-map/out/access-map.html`, or the review app's Access map
- {{CONTEXT.md exists | No CONTEXT.md: start one, so areas and capabilities use the domain's terms}}

## Next steps

- Review the commit: each rule's evidence and each stub is the trust gate.
- See the inventory: open `{{skill}}/viewer/inventory-viewer.html` and load `tools/access-inspector/inventory.json`. It lists endpoints, not roles.
- Wire `tools/access-inspector/ci-snippet.{{ext}}` into CI; it runs `{{check command}}`.
- Access map (who passes per role and per capability, with Alerts, Roles, Routes and How it's built tabs): once this fit is committed, ask `/all-access-inspector build the access map`; CI then runs `introspect.py --check` (Django) and `node {{skill}}/map/src/cli.ts check .`.
- Questions left open: {{none | list}}
