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

## Next steps

- Review the commit: each rule's evidence and each stub is the trust gate.
- See the inventory: open `{{skill}}/viewer/inventory-viewer.html` and load `tools/access-inspector/inventory.json`.
- Wire `tools/access-inspector/ci-snippet.{{ext}}` into CI; it runs `{{check command}}`.
- Questions left open: {{none | list}}
