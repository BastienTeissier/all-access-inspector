# UF9: Fit an unsupported stack

**Notion ticket:** *(not requested)*

## Context

A developer invokes the skill on a project whose stack has no Base Script (Flask, FastAPI, Express, Laravel...). Rather than stopping, the Agent improvises from the closest Base Script and makes the weaker guarantee visible.

## Specification

AAU (developer), invoking the skill in a repository on an unsupported stack, I see the Agent:
- name the detected stack and state that no Base Script exists for it
- pick the closest Base Script (by language and by framework shape) and say which and why
- attempt runtime discovery through the framework's own route registry when one exists, and only otherwise static discovery, stating the reason in the Adapted Script
- produce an Adapted Script with the same layout, the same schema and the same `--check` behaviour
- mark the inventory `coverage: best-effort` whatever the discovery mode, with a note naming the stack and the Base Script it derived from
- follow the same unknown loop, evidence and commit rules as UF3

## Success Scenario

- AAU, the project is FastAPI, I see the Agent start from the Django Base Script, enumerate `app.routes` at runtime, map FastAPI dependencies it can read, and produce an inventory marked `best-effort`.
- AAU, the project is Laravel, I see the Agent start from the Symfony Base Script and enumerate the router.

## Error Scenario

- AAU, the Agent cannot find any route registry or recognisable routing in source, I see it stop with an explanation and no Adapted Script committed.

## Edge Cases

- AAU, if an improvised Adapted Script later gets a real Base Script in the toolkit, update mode (UF5) offers to re-base it and drop the `best-effort` mark.
- AAU, if the security-audit skill reads a `best-effort` inventory, the report says so at the top (UF6).

## Acceptance Criteria

- [ ] The improvised Adapted Script validates against the shared schema and passes `--check` on its own output.
- [ ] `coverage` is `best-effort` and the note names the stack and the originating Base Script.
- [ ] The Agent never claims `complete` for an unsupported stack.
- [ ] Recognition Rules and Acknowledged Unknowns follow the UF3 rules.
