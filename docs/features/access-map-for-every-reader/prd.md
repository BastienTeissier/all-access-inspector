# PRD: Access map for every reader

## Why

- The access map (UF16 to UF18) answers "who can do what" per Role and per Capability, but the first refit of a real project (action-tracking, 287 endpoints) showed it does not yet speak to the people it is for. A product manager opening the Roles tab reads capability ids such as `action_tracking.emailwhitelistentry.change`; a developer or reviewer opening Alerts lands on 145 endpoints "behind no capability", most of them third-party sign-in routes, before any alert the map alone can raise.
- The map's extraction is Django-admin shaped. Only Django has a Map Introspect, and it reads admin pages: a plain API route is behind no capability on any stack, and on NestJS, Spring and Symfony every fact is hand-written and role-guarded routes stay "not resolved".
- The skill document that drives the Agent carries its four workflows (fit, update, triage, map) in one 3,600-word file, so every run loads three it does not need, and its prohibitions are repeated across sections.
- Business value: the map becomes something a product manager can read and a developer can act on, on every supported stack, and the Agent's fit of it ends on a stated criterion instead of wherever the Agent stops. A security review then starts from a page both can read.

Vocabulary used in this document is defined in [CONTEXT.md](../../../CONTEXT.md). This feature continues [all-access-inspector](../all-access-inspector/prd.md); user flows are numbered after its UF18.

## Result

### Acceptance Criteria

- [ ] On `fixtures/django-demo` and on action-tracking, every capability in an unfolded area has a name that is not its id, read from the code or from the vocabulary.
- [ ] Every REST resource of the inventory (a collection path with a detail sibling) sits behind a derived capability on every stack, with basis `inferred`, unless the vocabulary replaces it.
- [ ] `map check` prints coverage per area and names every first-party endpoint behind no capability; its exit code does not depend on coverage.
- [ ] The Alerts tab counts and opens on the map's own alerts; review signals appear as one line with a count; no endpoint is listed twice; the static page and the review app agree.
- [ ] A triage run reads SKILL.md, the triage workflow and the stack reference's triage checklist, and nothing of the fit or map workflows; each hard rule is written once.
- [ ] `fixtures/nestjs-demo` has a Map Introspect whose `runtime.json` is byte-stable, whose `--check` exits 1 on a difference, and whose Roles tab resolves every `@Roles()` route.

### Features

- Readable capability and area names extracted from the Django admin (verbose names and action words), with the vocabulary still renaming in the glossary's terms.
- Resource capabilities derived from the inventory's path shapes, stack-agnostic, renamed or replaced through the vocabulary.
- Coverage reported per area by `map check`, in the Agent's summary and in the page header, with first-party gaps named and third-party ones counted, listed under a `--third-party` flag.
- An Alerts tab ordered by what only the map can raise, coverage gaps rolled up by area, review signals as one count.
- The skill split into a router and four workflow files, with one source per fact and each prohibition paired with its positive rule.
- A NestJS Map Introspect reading roles, what sign-in grants, a policy map when there is one, and the roles each route names.

### Visual

Roles tab, one area, before and after:

```
before                                   after
Area: action_tracking.emailwhitelistentry   Area: Email whitelist entries   (term EmailWhitelistEntry, models.py:41)
  action_tracking.emailwhitelistentry.add     Add an email whitelist entry
  action_tracking.emailwhitelistentry.change  Change an email whitelist entry
  action_tracking.emailwhitelistentry.view    View email whitelist entries
  create-action                               Create an action             (vocabulary: "Create an action")
```

Alerts tab on action-tracking, before and after:

```
before: 196                               after: 0 (header: coverage 142 of 287, 23 first-party gaps)
▾ Behind no capability          145       ▾ Partial, not decided          0
  ANY /admin/users/user/{id}/password/    ▾ Findings                      0
  GET+HEAD /api/action-plans/             ▾ Not resolved                  0
  POST /accounts/3rdparty/signup/         ▸ Coverage
  …                                           action-tracking: 7 first-party endpoints behind no capability  → Routes
▸ Outside its expected access    50           platform: 16                                                    → Routes
▸ Outside expected access         1           third-party handlers: 122 (accounts-and-access, hijack)         → Routes
                                          ▸ Review queue: 50 signals on these endpoints                       → queue
```

`map check` output:

```
coverage: 142 of 287 endpoints behind a capability
  Actions: 9 of 11 · Action plans: 2 of 4 · Email whitelist entries: 4 of 4 · …
  first-party, behind no capability: GET+HEAD /api/action-plans/, GET+HEAD /api/actions/{pk}/, …
  third-party, behind no capability: 122 (allauth 66, hijack 2, admin 54) · --third-party lists them
  unnamed capabilities: none
open findings: 0
```

Runtime and vocabulary shapes stay in `schema/runtime.schema.json` and `schema/vocabulary.schema.json`; a capability and an area gain an optional extracted `name`, and a derived capability carries `derived: "resource"`.

### Use cases / edge cases

Reading journey:

```
product manager → Roles tab → area names and capability names in the domain's words
                            → click a cell → check, evidence, endpoints reached and missed
developer       → Routes tab → one row per endpoint, who passes, chain of checks, file:line
                             → filter "reachable by <role>" / "behind no capability"
reviewer        → Alerts tab → map alerts first (partial, finding, not resolved)
                             → coverage by area → Routes filtered
                             → one line to the review queue for the signals
```

Fit journey of the map (Agent):

```
inventory committed → vendor the Map Introspect (Django, NestJS) or none
  → Map Rules with evidence → run, --check exits 0
  → derived resources and extracted names appear in runtime/build
  → vocabulary: rename in glossary terms, fold third-party areas, in-handler checks
  → map pin, map check: coverage per area, first-party gaps, unnamed capabilities
  → done when every unfolded capability is named and every first-party gap is behind a capability
    or listed in the summary with why
```

Edge cases identified:

- A Django model with no `verbose_name`: Django derives one from the class name; the map uses it as it is.
- A custom admin action with no `short_description`: named after its function, which the vocabulary renames.
- A path with a detail sibling but a third-party handler (allauth `/accounts/…`): no derived capability; counted under third-party gaps.
- A resource whose collection and detail live under two prefixes (`/api/v1/actions/`, `/api/v2/actions/{pk}/`): two resources, one per prefix.
- A derived capability the vocabulary replaces by a hand-written one (`replaces`): the derived one disappears from the matrix and the check.
- A derived area has no term until the vocabulary `areas` entry gives it one; `map check` lists it under "areas with no term", never a failure.
- A project with every endpoint behind a capability: Coverage group absent, header says full coverage.
- A review signal on an endpoint behind no capability: counted once, under the review-queue line.
- A NestJS project with roles as string literals and no enum: the introspect reads nothing; a Map Rule `roles()` lists them with evidence, as on Django.
- A NestJS global guard with `@Public()` metadata: the route is `anyone`, as the inventory already says; the introspect adds nothing.
- A NestJS guard that compares something other than roles (tenant, ownership): a `relation` role through `RELATION_RULES`, or not resolved.
- A skill run with an unsupported stack: SKILL.md routes to `references/unsupported.md` as today; the fit workflow file is still the one followed.

### User Flows

| UF | Name | File |
|----|------|------|
| UF19 | Capabilities named in the domain's words | [uf19-capabilities-named.md](./uf19-capabilities-named.md) |
| UF20 | Capabilities from resources, on every stack | [uf20-capabilities-from-resources.md](./uf20-capabilities-from-resources.md) |
| UF21 | Coverage reported per area | [uf21-coverage-per-area.md](./uf21-coverage-per-area.md) |
| UF22 | Alerts that stay short | [uf22-alerts-that-stay-short.md](./uf22-alerts-that-stay-short.md) |
| UF23 | The skill split by branch | [uf23-skill-split-by-branch.md](./uf23-skill-split-by-branch.md) |
| UF24 | A NestJS Map Introspect | [uf24-nestjs-map-introspect.md](./uf24-nestjs-map-introspect.md) |

*(Each UF is documented in its own file. Notion integration was not requested.)*

## Decisions

- Coverage is reported, never a failure. `map check` fails on what is wrong (a moved line, a duplicate, an undecided partial), not on what is incomplete; incompleteness is visible in the header, the check output and the summary.
- Resource capabilities are derived by the map from the inventory, not proposed by the Agent: the same rule on every stack, basis `inferred`, and the vocabulary renames or replaces them.
- Review signals stay out of the map's alert count. The queue is their home; the map shows one line with their count and a link.
- A name read from the code is extracted, per ADR 0005: Django verbose names and action words are runtime facts, never vocabulary entries. The vocabulary still wins when it names a capability.
- Third-party handlers (a dotted name with no project file, as the triage already defines it) never get a derived capability; `map check` counts them per package and lists them only under `--third-party`.
- The skill splits by branch, not by stack: SKILL.md routes to `workflows/{fit,update,triage,map}.md`; stack facts stay in `references/<stack>.md`, which becomes their only source.
- The NestJS introspect runs through the project's test runner like its inventory script, reads Nest's reflector for `@Roles()` metadata, and leaves capabilities to the derived resources and the Map Rules.
- The superuser column stays; hiding columns is a page preference, not a map fact.

### Out of Scope

- Spring and Symfony Map Introspects (the NestJS one is the pattern; they follow in their own phase).
- Hand-written per-cell notes or findings in the vocabulary (kept computed, as decided before).
- Capabilities for operations inside GraphQL, WebSockets or server-sent events.
- A CI gate on coverage.
- Exporting the Roles tab to a document or a spreadsheet.
- Per-viewer column hiding on the Roles tab.

## Technical Specification

### Architecture

- **Django Map Introspect** (`base-scripts/django/access_map/admin.py`): reads `verbose_name`, `verbose_name_plural` and each admin action's `short_description`; writes `name` on areas and capabilities in the runtime.
- **Map package** (`skills/all-access-inspector/map/src/`): `resources.ts` derives resource capabilities from the inventory; `cells.ts` takes extracted names before falling back to ids; `coverage.ts` groups gaps per area and first-party vs third-party; `alerts.ts` drops `uncovered`, `signal` and `outside_expected` kinds in favour of one coverage summary and one queue line; `check.ts` prints coverage per area, gaps and unnamed capabilities.
- **Page and app** (`map/page.html`, `apps/review/app/map/`): the Alerts tab draws the new groups; the Routes tab gains the "behind no capability" filter and the domain link target; the header shows coverage.
- **Skill** (`skills/all-access-inspector/`): `SKILL.md` becomes the router; `workflows/fit.md`, `update.md`, `triage.md`, `map.md` hold the steps; `assets/summary-template.md` gains the coverage block.
- **NestJS Map Introspect** (`base-scripts/nestjs/access_map/`): `introspect.ts` booted by the project's test runner through the Adapted Script's boot, `project.ts` with the project section, writing `runtime.json` against `schema/runtime.schema.json`.

### Libraries & tools

- No new dependency. Django introspect: the project's own Django. Map package: TypeScript on Node 24. NestJS introspect: `@nestjs/testing` and the project's test runner, as the inventory script.

### Data Requirements

- `runtime.schema.json`: optional `name` on areas and capabilities; optional `derived: "resource"` on a capability.
- `vocabulary.schema.json`: unchanged shapes; `resources` entries may carry `name` and `term`.
- Review Log: unchanged. A derived capability is a valid cell key for decisions and signals.
- Fixture goldens: `fixtures/django-demo/expected/runtime.json` and a new `fixtures/nestjs-demo/expected/runtime.json`.

### Rights & Permissions

| Permission | Description | User Roles |
|------------|-------------|------------|
| Read the map | Open the static page or the app's Access map | Product manager, developer, security reviewer |
| Decide a cell | Append a `decided` event | Developer, security reviewer (human only) |
| Fit the map | Vendor the introspect, write Map Rules and the vocabulary, commit on a branch | Developer, security auditor, through the Agent |
| Merge the map commit | Accept Map Rules and vocabulary entries with their evidence | Reviewer of the PR |

### Testing strategy

- Django introspect: golden runtime of `fixtures/django-demo` with names; a unit test per naming rule.
- Map package: unit tests for resource derivation (detail sibling, prefixes, third-party exclusion, `replaces`), coverage grouping, alert ordering and deduplication; CLI scenarios in `map/tests/cli.spec.ts` for the check output; Playwright scenarios for the Alerts and Roles tabs in the app.
- Skill: `test.md` scenarios unchanged; a docs-consistency pass that every command and path a workflow file names exists; a manual run of each branch on `fixtures/django-demo`.
- NestJS introspect: `fixtures/nestjs-demo` golden runtime, `--check` tested with a modified fixture, CLI scenario building the map and resolving the roles.
- Proof: action-tracking refitted, with the before and after of coverage, names and alert counts in the plan.

## Production strategy

- Metrics, read from the files: share of capabilities named in unfolded areas; coverage per area; count of first-party gaps; alert count on the Alerts tab versus the review queue length; number of stacks with a Map Introspect.
- Error cases: an introspect that cannot read a name falls back to the id and the check lists it; a path shape the derivation cannot read stays a gap, never a wrong capability; a malformed runtime or vocabulary exits 2 as today.
- No telemetry; the toolkit never sends anything.
