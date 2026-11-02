# Implementation Plan: Access map for every reader

PRD: [prd.md](./prd.md). Continues [all-access-inspector-plan.md](../all-access-inspector/all-access-inspector-plan.md) (Phases 0–9d). Vocabulary: [CONTEXT.md](../../../CONTEXT.md) § Access map. Decisions: ADR 0005, ADR 0006.

## 1. Feature Description

**Objective**: make the access map readable by a product manager and actionable by a developer on every supported stack: capability and area names come from the code (Django verbose names, action words) or the vocabulary; REST resources become derived capabilities from inventory path shapes; coverage is reported per area in `map check`, the page header and the Agent summary; the Alerts tab counts only what the map alone raises; the skill splits by branch into a router plus four workflow files; NestJS gets a Map Introspect.

**Key Capabilities**:
- **CAN** name every capability of an unfolded area from `verbose_name` / `verbose_name_plural` / `short_description` (Django) or a vocabulary `extends`; the vocabulary name wins.
- **CAN** derive one capability per REST resource (collection path with a detail sibling under the same prefix) per verb, on every stack, basis `inferred`, `derived: "resource"`; vocabulary `extends` renames, `replaces` removes.
- **CAN** report coverage per area, first-party gaps named, third-party gaps counted per package (listed under `map check --third-party`), unnamed capabilities and areas with no term.
- **CAN** show an Alerts tab whose count = undecided partials + findings + open cells, plus a Coverage group and one "Review queue: N signals" line outside the count.
- **CAN** run one branch of the skill (fit, update, triage, map) loading only `SKILL.md`, that workflow file and the stack reference.
- **CAN** (NestJS) extract roles via Map Rule, sign-in grants, and per-route `who` from `@Roles()` metadata through the project's test runner; byte-stable `runtime.json`, `--check` exits 1 on diff.
- **CANNOT** fail `map check` on coverage; derive a capability for a third-party handler or a path with no detail sibling; list an endpoint twice on the Alerts tab; write a name into the vocabulary that the code declares; hide the superuser column; introspect Spring or Symfony; gate CI on coverage.

**Business Rules**:
- Name precedence per capability: vocabulary `extends.name` > runtime `name` > id. Area: vocabulary `areas[].name` > runtime area `name` > id. Term: vocabulary `areas[].term` only; a derived area with no vocabulary entry has no term, listed by `map check` under "areas with no term".
- Django names: model action ⇒ `"<Action> <verbose_name>"` (`add`, `change`, `delete`, singular) / `"View <verbose_name_plural>"` (`view`); custom action ⇒ `short_description` else function name; area name = `verbose_name_plural`, capitalised as Django gives it.
- Resource = inventory paths sharing a prefix where `<prefix>/` (collection) and `<prefix>/{param}/` (detail) both exist. Verbs: `list` GET collection, `read` GET detail, `create` POST collection, `update` PUT/PATCH detail, `delete` DELETE detail. Nested path `<prefix>/{param}/<segment>/` ⇒ own capability `resource.<prefix-slug>.<segment>`, named by `<segment>` capitalised (`Refund`). Different prefixes ⇒ different resources; prefixes that differ only by a parameter (`/api/items`, `/api/{version}/items`) ⇒ one resource; a nested action named like a verb joins that verb's capability. Id `resource.<prefix-slug>.<verb>`; area = `<prefix-slug>`. Endpoint with a third-party handler ⇒ never derived. First-party = `handlerFile(handler) !== null` (`review/src/inventory.ts`) or listed in the runtime's `first_party` (dotted handlers the Map Introspect resolves to project code); with neither, on `nestjs` and `spring`, first-party unless the dotted prefix is a framework package (`org.springframework.`, `@nestjs/`). Existing vocabulary `resources` regex rules keep labelling the Routes column; both coexist.
- Coverage: covered = endpoint listed by ≥1 capability (extracted, rule, derived, curated). Per area: capabilities' endpoints grouped by the capability's area after folding. Gaps split first-party / third-party by handler shape; third-party counted per package (first dotted segment, `allauth`, `hijack`, `django.contrib.admin` ⇒ `admin`).
- Alerts: kinds `undecided`, `finding`, `open` only, in that order; count = their sum. Coverage group: one line per area with ≥1 first-party gap + one third-party line, each linking to Routes filtered. Queue line: count of review signals (`SIGNAL_IDS`) on the endpoints plus open agent signals on cells, linking to the review queue. Full coverage ⇒ no Coverage group, header "every endpoint behind a capability".
- `map check` output: `coverage: N of M endpoints behind a capability` → per-area line → `first-party, behind no capability:` list → `third-party, behind no capability: K (pkg n, …) · --third-party lists them` → `unnamed capabilities:` list or `none` → `areas with no term:` list or `none` → `open findings:`. Per-area lines only for areas holding ≥1 capability; first-party gaps always listed in full. Exit code unchanged (problems only).
- Skill: `SKILL.md` ≤ 1,200 words, description ≤ 40 words; one hard rule in one place; stack facts only in `references/<stack>.md`; every branch ends on a stated completion criterion (fit: every unknown acknowledged; map: every unfolded capability named and every first-party gap covered or listed with why).
- NestJS introspect: project section `roles()`, `includes()`, `staff()`, `grants()`, `scopes()`, `scoped()`, `capabilities()` Map Rules with evidence, `FIRST_PARTY`, `SUPERUSER_RULES`, `SIGNED_IN_RULES`, `RELATION_RULES`. Per route: the inventory's authorization `rule` is `recognition:<name>` and that Recognition Rule (Adapted Script `rules.ts`) carries `rawMetadata` ⇒ read `Reflect.getMetadata(rawMetadata, handler) ?? (…, controller)` ⇒ `verdict {kind: groups, roles: literals, basis: extracted, how: "<rule name>: <construct> <key>=[…]"}` (at = rule evidence); no such rule ⇒ `verdict null`; `fallback` from inventory authentication (`anyone` / `signed_in`) else `custom`; `@Public()` routes stay `anyone`. No `ROLES_KEY`: a matched rule proves the guard runs and names the key. Literals not declared by `roles()` ⇒ `map check` "a check names role X, which is not a role". Same canonical serialisation as Django's `runtime.py`.

**Visual Design**: Roles tab, Alerts tab and `map check` before/after in [prd.md § Visual](./prd.md#visual).

---
## 2. Data Model

No database. Contracts: `skills/all-access-inspector/schema/runtime.schema.json`, `schema/vocabulary.schema.json`, the map's `PageData` (`map/src/data.ts`). Review Log unchanged.

### Creation of New Entities

- **Runtime area** (`runtime.areas[]`, new optional key, after `roles`): `{id, name, at}`. Django: one per admin model, `id` = `app.model`, `name` = `verbose_name_plural` as Django gives it, `at` = model class `file:line`. NestJS: `[]`. Sorted by `id`.
- **Derived capability** (map package only, never in `runtime.json`): built by `resources.ts` from the inventory. `Capability` gains `derived: 'resource' | null`. Shape: `id` = `resource.<prefix-slug>.<verb>`, `name` = `"<Verb> <last segment>"`, the segment as is (`List invoices`, `Read invoices`…), `area` = `<prefix-slug>` (`api.invoices`), `term` = null, `verb` = `read` (list, read) | `write` (create, update, delete), `endpoints` = the resource's keys for that verb, `check` = the endpoint's `who.how`, `at` = null, `basis` = `inferred`, `reason` = null. `<prefix-slug>` = path prefix with leading `/` dropped, `/` → `.`, params excluded.
- **Coverage** (`coverage.ts`, in `PageData` and used by `check.ts`):
  ```
  { covered: number, total: number,
    areas: [{ id, name, covered, total, gaps: Key[] }],   // first-party, per capability area after folding; endpoints behind no capability grouped by domain when no area owns them
    third_party: { total: number, packages: [{ name, count, endpoints: Key[] }] },
    unnamed: string[],      // capability ids whose name === id in an unfolded area
    untermed: string[] }    // area ids with no vocabulary term and no runtime term
  ```
- **Queue summary** (`PageData.queue`): `{ signals: number }`: every review signal on an endpoint, plus each open agent `signal_raised` on a cell.
- **NestJS runtime** (`fixtures/nestjs-demo/tools/access-map/runtime.json`): same schema; `stack: "nestjs"`, `about.command: "pnpm exec vitest run tools/access-map/introspect.spec.ts"` (or jest), `areas: []`, `capabilities` from Map Rules only (`basis: "rule"`), `endpoints[].verdict` = `{kind: "groups", roles: [...], basis: "extracted", how: "roles: RolesGuard roles=[…]"}` when the endpoint's authorization Recognition Rule has `rawMetadata`, else `null`; `fallback` from inventory authentication (`anyone` / `signed_in`) or `custom`.

### Modification of Existing Entities

- **Runtime capability** (`runtime.capabilities[]`): optional `name` (string). Django: `"<Action> <verbose_name>"` for add/change/delete, `"View <verbose_name_plural>"` for view, `short_description` or function name for custom actions.
- **Vocabulary**: shapes unchanged. `areas[].name` and `capabilities[].extends.name` keep precedence over runtime names. `resources[]` (regex → label) unchanged, still feeds the Routes column.
- **Map `Capability`** (`cells.ts`): `name` precedence vocabulary > `runtime.name` > `id`; new `derived`.
- **`PageArea`** (`data.ts`): `name` precedence vocabulary > `runtime.areas[].name` > `id`; `term` from vocabulary (required unless the area folds others); an area with no vocabulary entry takes its capabilities' extracted `term`, else null; `defined_at` from vocabulary else `runtime.areas[].at`.
- **`Alert`** (`alerts.ts`): `kind` narrowed to `undecided | finding | open`.
- **`PageData`**: `coverage` replaced by the structure above; `queue` added; `alerts` holds the three kinds only.
- **`check.ts` output**: coverage block per § 1 Business Rules; `--third-party` flag lists third-party gap endpoints.
- **NestJS project section** (`base-scripts/nestjs/access_map/project.ts`): `FIRST_PARTY`, `SUPERUSER_RULES`, `SIGNED_IN_RULES`, `RELATION_RULES`, `roles()`, `includes()`, `staff()`, `grants()`, `scopes()`, `scoped()`, `capabilities()`, mirroring `django/access_map/project.py`.

### Relationships

- Derived capability → inventory endpoints by key, same as extracted (`endpointsOf`); vocabulary `extends` names it, `replaces` removes it; `areas[].contains` folds its area.
- Coverage → capabilities (all bases): endpoint covered ⇔ listed by ≥1 capability after `replaces`. Gaps → area by domain (`join.ts domainOf`) when no capability owns the endpoint; one area line per vocabulary area or domain with ≥1 first-party gap.
- Queue → inventory endpoint signals (`SIGNAL_IDS`) + Review Log agent events; disjoint from `alerts`.
- Runtime `areas[]` ↔ `capabilities[].area` by id; an area with capabilities and no `areas[]` entry keeps `id` as name.

---
## 3. Architecture

⚪ reuse / 🟢 new. Root `skills/all-access-inspector/` = `S`.

### Files to Modify

#### A. ⚪ `S/base-scripts/django/access_map/admin.py` (UF19)
**Purpose**: extracted names. **Changes**: `admin_entries()` reads `opts.verbose_name`, `opts.verbose_name_plural`, model `file:line` (`inspect.getsourcefile` + `getsourcelines`, relative to `ROOT`) into each entry; `Introspect.capabilities()` sets `name` per action (`add/change/delete` ⇒ `f"{Action} {verbose_name}"`, `view` ⇒ `f"View {verbose_name_plural}"`, custom ⇒ `short_description` or function `__name__`); new `Introspect.areas()` ⇒ `[{id, name, at}]`. **Why**: ADR 0005, a name the code declares is extracted.

#### B. ⚪ `S/base-scripts/django/access_map/{introspect.py,runtime.py}` (UF19)
**Changes**: `build()` adds `"areas": introspect.areas()`; `runtime.py KEYS` gains `areas` after `roles`, `IDENTITY["areas"] = ("id",)`. Vendored copies in `fixtures/django-demo/tools/access-map/` regenerated (copy), golden `fixtures/django-demo/expected/runtime.json` updated.

#### C. ⚪ `S/schema/runtime.schema.json` (UF19)
**Changes**: optional `areas` array `{id, name, at}` (`additionalProperties: false`); optional `name` on capability items. `S/base-scripts/django/tests/test_schema.py` covers it.

#### D. ⚪ `S/map/src/runtime.ts` + `cells.ts` (UF19, UF20)
**Changes**: `Runtime.areas?: RuntimeArea[]`, `RuntimeCapability.name?`; `loadRuntime` accepts both. `Capability` gains `derived: 'resource' | null`; `capabilityList` name precedence `n?.name ?? c.name ?? c.id`; takes derived caps as third input `[...extracted, ...derived, ...curated]`, `replaced` filters derived too.

#### E. 🟢 `S/map/src/resources.ts` (UF20)
**Exports**: `resources(endpoints: MapEndpoint[], firstParty: (handler) => boolean): Capability[]`. Groups paths by prefix; requires `<prefix>/` and `<prefix>/{p}/` both present with ≥1 first-party handler; emits one `Capability` per verb present (`list read create update delete`), nested `<prefix>/{p}/<seg>/` as `resource.<prefix-slug>.<seg>`; trailing slash tolerant (Nest paths have none). Third-party-handler endpoints skipped. 🟢 `join.ts isFirstParty(handler, stack)`: ⚪ `handlerFile` from `S/review/src/inventory.ts` (already imported by `cells.ts`), else on `nestjs`/`spring` true unless prefix `org.springframework.` / `@nestjs/`.

#### F. 🟢 `S/map/src/coverage.ts` (UF21)
**Exports**: `coverage(caps, found, endpoints, areas, vocabulary): Coverage` (§ 2 shape). Package of a third-party handler = first dotted segment, `django.contrib.admin` ⇒ `admin`. Gap with no capability area ⇒ grouped by `domainOf` label, else `"no area"`.

#### G. ⚪ `S/map/src/data.ts` (UF19–UF22)
**Changes**: `project()` calls `resources()` before `capabilityList`; `areaList` reads `runtime.areas` for name/`defined_at`, extracted `term` from capabilities; `buildData` fills `coverage` (F), `queue` (signals + agent events), `alerts` with the three kinds; `PageData` types updated.

#### H. ⚪ `S/map/src/alerts.ts` (UF22)
**Changes**: `ALERT_KINDS = ['undecided','finding','open']`; drop `uncovered`, `agent`, `signal`, `outside_expected` branches and `SIGNAL_LABELS` export (moved to queue). Signature loses `endpoints` and `covered`.

#### I. ⚪ `S/map/src/check.ts` + `cli.ts` (UF21)
**Changes**: replace single coverage line by the block (§ 1 rules) from `p.coverage`; `--third-party` boolean option on `check` lists third-party gap endpoints grouped by package; `problems` gains one rule (UF24): a `who` of kind `groups` naming a role that is not on the map (today only `relations` is checked) ⇒ `a check names role X, which is not a role`.

#### J. ⚪ `S/map/page.html` (UF21, UF22)
**Changes**: `KINDS` trimmed to three; Alerts renderer draws Coverage `<details>` (area lines → `#routes` with filter `gap=<area>`, third-party line → filter `gap=third-party`) and "Review queue: N signals" line (href to app queue when `data.method.queueHref`, else plain text); header reads `coverage.covered/total`, "every endpoint behind a capability" when equal; Routes filter `#f-gap` "Behind no capability" + per-area option; hash routing reads `gap`.

#### K. ⚪ `apps/review/app/map/{page.tsx,routes.tsx,labels.tsx}` (UF21, UF22)
**Changes**: mirror J in React: `KINDS` three entries, `Alerts` draws Coverage + queue line (`<Link href="/queue">`), header coverage, Routes `gap` filter via search params. `apps/review/lib/projection.ts` unchanged (it calls `buildData`).

#### L. ⚪ `S/SKILL.md` → router (UF23) + 🟢 `S/workflows/{fit,update,triage,map}.md`
**Changes**: SKILL.md keeps Stack terms, hard rules (each once, positive phrasing), a branch table (fit / update / triage / map → file + stack reference section), completion criteria per branch. Workflow files take the steps verbatim from today's sections 38–182, with stack facts removed in favour of a pointer to `references/<stack>.md § <section>`. Frontmatter description ≤ 40 words. `S/assets/summary-template.md`: Coverage block (per area, first-party gaps, third-party count, unnamed, untermed). `references/{django,nestjs}.md § Map introspect` updated (Nest: ships now).

#### M. 🟢 `S/base-scripts/nestjs/access_map/{introspect.ts,project.ts,runtime.ts,introspect.spec.ts}` + ⚪ `inspect.sh` (UF24)
**`project.ts`**: project section (`FIRST_PARTY`, rule lists, Map Rule functions returning `[]`, `lineOf(path, text)`), mirrors `django/access_map/project.py`. **`introspect.ts`**: imports ⚪ `../access_inspector/boot.ts` (`boot()`), `discovery.ts` (`discover`), `classify.ts` (`metadata`), `rules.ts` (`RECOGNITION`, the Adapted Script's); per inventory row: authorization `rule` `recognition:<name>` whose rule has `rawMetadata` ⇒ `metadata(controller, handler)[rawMetadata]` ⇒ `verdict groups`; else `null`; `fallback` from inventory authentication; `roles`/`grants`/`scopes`/`scoped`/`capabilities` from Map Rules validated like `facts()`; `build()` → runtime object; `about` constant. **`runtime.ts`**: `KEYS`, `IDENTITY`, `canonical`, `toCanonicalJson` (port of Python, same bytes), `check()` diff. **`introspect.spec.ts`**: the test-runner entry (like `run.spec.ts`), env `ACCESS_MAP_MODE=write|check`, writes `tools/access-map/runtime.json`. **`inspect.sh`**: accepts `map` subcommand ⇒ runs `tools/access-map/introspect.spec.ts`. Vendored into `fixtures/nestjs-demo/tools/access-map/` with `vocabulary.json`, `project.ts` filled (`roles()` ⇒ `admin`, `partner` with evidence from `roles.decorator.ts`/controllers), golden `fixtures/nestjs-demo/expected/runtime.json`, test `fixtures/nestjs-demo/tests/map-golden.spec.ts` (⚪ pattern `test_map_golden.py`). Makefile `test-nestjs` runs it through the fixture's `vitest run` already.

#### N. ⚪ `VERSION` (final phase)
`0.4.0` → `0.5.0`; every fixture golden `base_script.version` regenerated.

---
## 4. Test Plan

Only the added behaviour. Existing goldens regenerated, not re-tested.

### Unit Tests

**Django introspect** (`S/base-scripts/django/tests/test_admin_names.py`, 🟢, pattern `test_map_rules.py`):
- `test_model_action_names`: `verbose_name="order"`, plural `"orders"` ⇒ add `Add order`, change `Change order`, delete `Delete order`, view `View orders`.
- `test_model_without_verbose_name_uses_django_default`: class `EmailWhitelistEntry` ⇒ `View email whitelist entrys` as Django derives (no fix-up).
- `test_custom_action_short_description_else_function_name`.
- `test_areas_one_per_admin_model_with_name_and_at`.
- `test_schema.py`: runtime with `areas` and capability `name` validates; `areas` item with an extra key fails.

**Map package** (`S/map/tests/`):
- `join.spec.ts` 🟢 (or in `cells.spec.ts`): `isFirstParty`: `shop/views.py:12` yes, `allauth.account.views.LoginView` no, `AdminController.list` on nestjs yes, `org.springframework.boot.autoconfigure.web.servlet.error.BasicErrorController.error` on spring no.
- `resources.spec.ts` 🟢: collection + detail ⇒ `list`, `read`, `create`, `update`, `delete` by method present; `/api/stats/` alone ⇒ none; nested `/api/actions/{pk}/duplicate/` ⇒ `resource.api.actions.duplicate`; two prefixes ⇒ two resources; third-party handler on both paths ⇒ none; mixed handlers ⇒ first-party only; Nest paths without trailing slash; ids stable across endpoint order.
- `cells.spec.ts`: `name` precedence vocabulary > runtime `name` > id; `replaces` drops a derived capability; `derived` is `'resource'` only on derived ones.
- `coverage.spec.ts` 🟢: per-area counts after folding; gap with no area grouped by domain; third-party packages counted (`allauth.account.views.X` ⇒ `allauth`, `django.contrib.admin…` ⇒ `admin`); `unnamed` lists ids whose name is the id in unfolded areas only; `untermed` lists areas with neither vocabulary nor extracted term; full coverage ⇒ `areas` gaps empty.
- `alerts.spec.ts` 🟢: only `undecided`, `finding`, `open` kinds, in that order; an endpoint with a signal and no capability appears in `queue.endpoints` once and in no alert.
- `data.spec.ts` 🟢 (or in `cells.spec.ts`): `areaList` takes `runtime.areas` name and `at`, extracted `term` from capabilities, vocabulary first.

**NestJS introspect** (`S/base-scripts/nestjs/tests/`):
- `map-runtime.spec.ts` 🟢: `toCanonicalJson` bytes equal `schema/samples/` reference for the runtime shape (one item per line, key order, sorted identities); `check()` diff lines `~ + -`.
- `map-rules.spec.ts` 🟢: Map Rules ship empty; a rule fact without `at` is a `MapRuleError`; `lineOf` names missing text.
- `map-introspect.spec.ts` 🟢 (booting the fixture through `@nestjs/testing`): row with `recognition:roles` and `@Roles('admin')` on the method ⇒ `verdict {kind: groups, roles: ['admin'], basis: extracted}`; `@Roles()` on the class only ⇒ every route of the controller; method overrides class; `@Roles()` present but no Recognition Rule with `rawMetadata` matched ⇒ `verdict null` (decorator without guard); `@Public()` route ⇒ `verdict null`, fallback `anyone`; session guard, no roles ⇒ fallback `signed_in`; a literal not in `roles()` is kept (the map check reports it).

### Integration Tests

- `fixtures/django-demo/tests/test_map_golden.py`: existing golden now holds `areas` and names (regenerated); `test_map_vendored_copy_matches_base_script` unchanged.
- `fixtures/nestjs-demo/tests/map-golden.spec.ts` 🟢 (pattern `test_map_golden.py`): golden equal; schema valid; two runs identical bytes; `--check` clean exits 0, prints `runtime up to date`; `--check` after editing a `@Roles()` literal exits 1 with a `~` line; vendored copy matches base script.
- `S/map/tests/cli.spec.ts`: `map check` prints coverage block in order (`coverage:`, per-area line, `first-party, behind no capability:`, `third-party … · --third-party lists them`, `unnamed capabilities:`, `areas with no term:`), exit 0 with gaps; `--third-party` lists endpoints by package; a derived capability's partial cell can be decided and fails/passes the check like an extracted one; `build` page data holds `coverage.areas` and `queue`, `alerts` three kinds; on `fixtures/nestjs-demo` the `admin` role passes `resource.api.admin.users.list` and `anonymous` does not.
- `apps/review/tests/projection.spec.ts`: projection exposes `coverage` and `queue`.
- `apps/review/tests/e2e/map.spec.ts`: Alerts tab count equals undecided + findings + open; Coverage group lists one line per area with gaps and links to Routes filtered by `gap`; "Review queue: N signals" links to `/queue`; existing "static page agrees" test extended to the count and the Coverage lines.
- Skill (manual, recorded in the PR): word count `SKILL.md` ≤ 1,200, description ≤ 40; `docs-consistency` pass over `workflows/*.md`; grep that each hard rule sentence occurs once across `SKILL.md` + `workflows/`; one run per branch on `fixtures/django-demo`.
- Proof: action-tracking refit on `chore/access-inspector/refit`, before/after of coverage, names, alert count written in § Notes.

---
## 5. To Do List

Phases continue the previous plan (last: 9d). One PR per phase; each ends green on `make check-all test`.

### Phase 10 — UF19, UF21 Names extracted, coverage per area

- [ ] **Schema**: `runtime.schema.json` optional `areas[] {id,name,at}` and capability `name`; `test_schema.py` cases (§ 4).
- [ ] **Django introspect**: `admin_entries()` reads verbose names + model `file:line`; `capabilities()` sets `name`; `areas()`; `build()` and `runtime.py KEYS/IDENTITY` take `areas`; `test_admin_names.py`.
- [ ] **Fixture**: copy `access_map/*` to `fixtures/django-demo/tools/access-map/`; regenerate `expected/runtime.json`; `test_map_golden.py` green.
- [ ] **Map types**: `runtime.ts` `RuntimeArea`, `name?`; `cells.ts` name precedence; `data.ts areaList` reads `runtime.areas` and extracted terms; `cells.spec.ts` precedence case.
- [ ] **Coverage**: `coverage.ts` + `coverage.spec.ts`; `data.ts buildData` fills `PageData.coverage`; `check.ts` prints the block; `cli.ts` `--third-party`; `cli.spec.ts` block-order and `--third-party` cases.
- [ ] **Renderers**: `page.html` and `apps/review/app/map/page.tsx` header line from `coverage`; `projection.spec.ts` field present.
- [ ] **Summary template**: `assets/summary-template.md` Coverage block; `SKILL.md § Map` step 9 names the two new check lines (moved to `workflows/map.md` in Phase 13).
- [ ] **Verify**: on `fixtures/django-demo`, Roles tab shows `Orders` / `Add order` with no vocabulary `extends`; `map check` prints the block, exit 0; on action-tracking `map check` names 23 first-party gaps and `third-party … 122 (allauth 66, hijack 2, admin 54)`; every unfolded capability named.

### Phase 11 — UF22 Alerts that stay short

- [ ] **Alerts**: `alerts.ts` three kinds, signature trimmed; `data.ts` `queue` + call-site; `alerts.spec.ts`.
- [ ] **Static page**: `KINDS` three entries; Coverage group + queue line in the Alerts renderer; `#f-gap` Routes filter with per-area options; hash `gap=`; `#alert-count` from three kinds.
- [ ] **App**: `page.tsx Alerts` + `routes.tsx` `gap` search param + `labels.tsx KINDS`; queue line `<Link href="/queue">`.
- [ ] **E2E**: `map.spec.ts` cases (§ 4); static-page agreement extended.
- [ ] **Verify**: action-tracking Alerts tab reads 0, Coverage group lists `action-tracking: 7`, `platform: 16`, third-party `122`, queue line `50 signals`; no endpoint listed twice (script: count keys across groups).

### Phase 12 — UF20 Capabilities from resources

- [x] **First-party test**: `join.ts isFirstParty(handler, stack)` over ⚪ `handlerFile`, shipped in Phase 10 (coverage needs it), cases in `data.spec.ts`.
- [x] **First-party as an introspect fact**: a dotted first-party handler (`shop.views.PingHook`) has no file:line and is read as third-party; record first-party in the runtime instead of guessing it in `join.ts` (PR #20 review).
- [x] **ADR 0007**: `docs/adr/0007-derived-facts-come-from-the-inventory.md`: the map derives resource capabilities from inventory shapes, same rule on every stack, basis `inferred`; options rejected: introspect-written, Agent-proposed; consequences: `replaces` overrides, coverage reported not failed, `CONTEXT.md` ladder gains a derived rung.
- [x] **Derivation**: `resources.ts` + `resources.spec.ts`; `cells.ts capabilityList(runtime, vocabulary, derived)` with `derived` field and `replaces` on derived; `data.ts project()` wires it.
- [x] **Check and page**: a derived capability shows `inferred` basis badge, `derived` tag in cell panel (`page.html`, `cell-panel.tsx`); `check.ts` unnamed list excludes derived names (they are named); `cli.spec.ts` derived decision round trip.
- [x] **Fixture**: `fixtures/django-demo` gains `resource.api.invoices.*`; vocabulary `extends` one of them (`"See invoices"`); coverage rises (record number): 12 → 14 of 72 (`list` GET+HEAD `/api/invoices/`, `delete` DELETE `/api/invoices/{pk}/`; `/api/orders` has no collection, so no resource).
- [x] **Docs**: `CONTEXT.md § Access map` Capability definition ("a resource verb" now derived, basis `inferred`); `references/django.md`, `nestjs.md` § Map introspect mention derived resources need no introspect.
- [ ] **Verify**: action-tracking refit: `GET+HEAD /api/action-plans/`, `/api/actions/{pk}/` leave the first-party gaps; remaining gaps listed; `map check` exit 0; one `replaces` on a derived capability drops it.

### Phase 13 — UF23 The skill split by branch

- [ ] **Workflows**: `workflows/fit.md` (steps 1–8), `update.md` (Update mode), `triage.md`, `map.md` from `SKILL.md` lines 38–182; stack facts replaced by pointers to `references/<stack>.md § <section>`; each ends on a completion criterion (fit: every unknown acknowledged, inventory `--check` 0; update: rules whose evidence vanished named; triage: every row in scope carries one event, one batch; map: every unfolded capability named, every first-party gap covered or listed with why).
- [ ] **Router**: `SKILL.md` ≤ 1,200 words: stack terms, hard rules once with positive phrasing, branch table (trigger → workflow file → reference section), description ≤ 40 words; apply `/writing-for-agents`.
- [ ] **References**: `references/*.md` hold every stack fact removed from SKILL.md (move, no copy); `assets/summary-template.md` pointers updated; README skill section links.
- [ ] **Verify**: `wc -w SKILL.md` ≤ 1,200; `docs-consistency` on `workflows/`; grep each hard rule occurs once; a subagent runs triage on `fixtures/django-demo` reading only SKILL.md + `workflows/triage.md` + `references/django.md § Triage checklist` (record which files it opened).

### Phase 14 — UF24 A NestJS Map Introspect

- [ ] **Runtime port**: `nestjs/access_map/runtime.ts` (`KEYS`, `IDENTITY`, `toCanonicalJson`, `check`); `tests/map-runtime.spec.ts` byte-equal to the Python output on the Django golden.
- [ ] **Project section**: `access_map/project.ts` (`FIRST_PARTY`, rule lists, Map Rule functions with docstring examples, `lineOf`); `tests/map-rules.spec.ts`.
- [ ] **Introspect**: `access_map/introspect.ts` (boot via `access_inspector/boot.ts`, routes via `discovery.ts`, roles metadata via the Adapted Script's `RECOGNITION` rules with `rawMetadata` and `classify.ts metadata()`, `verdict`/`fallback`, Map Rules, `about`); `introspect.spec.ts` entry with `ACCESS_MAP_MODE`; `inspect.sh map [--check]`; `tests/map-introspect.spec.ts`.
- [ ] **Fixture**: vendor to `fixtures/nestjs-demo/tools/access-map/`; `project.ts` `roles()` ⇒ `admin`, `partner` with `at`; `vocabulary.json` (areas `api.admin.users`, `api.products`; role names); golden `expected/runtime.json`; `tests/map-golden.spec.ts`; `typecheck-nestjs` includes `access_map/`.
- [ ] **Skill and docs**: `references/nestjs.md § Map introspect` (vendor, run, what it reads: Recognition Rules with `rawMetadata`, blind spots: guards comparing non-role claims); `workflows/map.md` stack branch; README stack table.
- [ ] **Verify**: `make test-nestjs typecheck-nestjs` green; `map build` on `fixtures/nestjs-demo` resolves `DELETE /api/admin/users/{id}` to `admin` only, `GET /api/products` to everyone, `GET /api/admin/users/stats` signed-in staff (no roles) ; `map check` exit 0; `--check` after editing `@Roles('admin')` exits 1.

### Phase 15 — Release

- [ ] **VERSION** `0.5.0`; regenerate every fixture golden (`inventory.json`, `runtime.json`) across django, nestjs, nestjs-jest-smoke, spring, symfony.
- [ ] **Docs**: README Access map section (names, coverage, derived resources, NestJS); `CONTEXT.md` relationships (derived capability, coverage, queue line); ADR 0007 linked from README and `CONTEXT.md`.
- [ ] **Verify**: `make check-all test`; action-tracking refit on `chore/access-inspector/refit` with 0.5.0; before/after table in § Notes.

---
## 6. Context: Current System Architecture

### Map package (`S/map/src/`)
- Current behavior: `data.ts project()` loads inventory, Review Log, vocabulary, runtime; `cells.ts capabilityList` = extracted (renamed by `extends`, folded by `contains`, removed by `replaces`) + curated; `cells()` joins decisions; `alerts.ts` builds seven alert kinds; `check.ts` lists problems then one coverage line; `cli.ts` injects `PageData` into `page.html`.
- Current limitations: capability `name` falls back to the id; area name from vocabulary only; coverage one total; `uncovered` alerts list every gap endpoint, signals one alert each; no resource derivation; `resources` vocabulary rules only label the Routes column.

### Django Map Introspect (`S/base-scripts/django/access_map/`)
- Current behavior: `admin.py admin_entries()` walks every admin site's registry, per ModelAdmin builds `{prefix, model, term: object_name, at, permissions, overrides}`; `capabilities()` one per admin action (`app.model.action`), plus `stack.admin_actions`; `introspect.py build()` merges Map Rule facts; `runtime.py` canonical bytes + `--check`.
- Current limitations: reads `object_name` only; no `areas` list; the vendored copy is a plain file copy checked by `test_map_vendored_copy_matches_base_script`.

### NestJS Base Script (`S/base-scripts/nestjs/access_inspector/`)
- Current behavior: `inspect.sh` runs `run.spec.ts` under the project's vitest/jest with `ACCESS_INSPECTOR_MODE`; `boot.ts` boots the root module via `@nestjs/testing` with the project section's `ENTRY/CONFIGURE/ENVIRON/STUBS`; `discovery.ts` lists routes; `classify.ts` reads guard metadata through `Reflect.getMetadata`; `rules.ts` resolves access.
- Current limitations: no `access_map/`; `references/nestjs.md § Map introspect` says none ships; the fixture's roles are string literals under a project `ROLES` key.

### Page and app
- Current behavior: `page.html` (vanilla JS, hash routing, `KINDS` map, `#alert-count`) and `apps/review/app/map/` (React, same `PageData` via `lib/projection.ts buildData`) render tabs roles / routes / alerts; e2e `map.spec.ts` asserts both agree.
- Current limitations: Routes filters `#f-sig` (has signals) and per-role reach; no gap filter; header coverage one ratio.

### Skill
- Current behavior: `SKILL.md` 3,576 words, sections Stack terms / Hard rules / Workflow / Update mode / Triage / Map / Look at the map; `references/<stack>.md` with the same section layout per stack; `assets/summary-template.md`.
- Current limitations: every run loads every branch; hard rules repeated inside Triage and Map; stack facts duplicated between SKILL.md and references.

### Key Files
| File | Purpose |
|------|---------|
| `S/map/src/data.ts` | `project()`, `buildData()`, `PageData` consumed by page, app and check |
| `S/map/src/cells.ts` | `Capability`, `capabilityList`, `endpointsOf`, cell states |
| `S/map/src/alerts.ts` | Alert kinds and ordering |
| `S/map/src/check.ts` | `map check` problems and report |
| `S/map/src/join.ts` | `MapEndpoint`, `who`, `resourceOf`, `domainOf` |
| `S/map/src/vocabulary.ts` | Vocabulary types, `missingTerms`, `duplicates`, `staleReferences` |
| `S/map/page.html` | Static page |
| `apps/review/app/map/*.tsx`, `apps/review/lib/projection.ts` | App map tab |
| `S/base-scripts/django/access_map/{admin,introspect,project,runtime}.py` | Django Map Introspect |
| `S/base-scripts/nestjs/access_inspector/{boot,discovery,classify}.ts`, `inspect.sh` | Nest boot and route discovery to reuse |
| `S/schema/{runtime,vocabulary}.schema.json` | Contracts |
| `fixtures/django-demo/tests/test_map_golden.py` | Golden + determinism + `--check` pattern |
| `fixtures/nestjs-demo/src/auth/{roles.decorator,roles.guard}.ts` | `@Roles()` metadata the introspect reads |
| `S/SKILL.md`, `S/references/*.md`, `S/assets/summary-template.md` | Skill |

---

## 7. Reference Implementations

- **Extracted fact renamed by the vocabulary**: `cells.ts capabilityList` (`extends` → `name`), `roles.ts roleList` (`named.get(r.id)?.name ?? r.id`). Same precedence for runtime names.
- **Fold / replace**: `cells.ts foldedInto`, `replaced` set. Derived capabilities enter the same pipeline.
- **Check report block after problems**: `check.ts` `coverage:` / `open findings:` lines. Extend in place.
- **Canonical runtime bytes + diff**: `django/access_map/runtime.py canonical / to_canonical_json / check`; inventory counterpart in TypeScript `nestjs/access_inspector/inventory.ts` (serialiser) and `tests/check.spec.ts`. Port the Python to TS beside the inventory serialiser.
- **Map Rule facts validation**: `django/access_map/introspect.py facts(rule, keys)` and `MapRuleError`.
- **Project section with examples**: `django/access_map/project.py` docstrings; `nestjs/access_inspector/boot.ts` project section (`ENTRY`, `STUBS`).
- **Test-runner entry with mode env**: `nestjs/access_inspector/run.spec.ts` + `inspect.sh` (`ACCESS_INSPECTOR_MODE`, stdout/stderr/status files).
- **Metadata read on handler then class**: `nestjs/access_inspector/classify.ts metadata(controller, handler)`; fixture `roles.guard.ts getAllAndOverride(ROLES, [handler, class])`.
- **Golden fixture tests**: `fixtures/django-demo/tests/test_map_golden.py` (golden, schema, determinism, check clean, check diff, vendored copy); `fixtures/nestjs-demo/tests/golden.spec.ts` for the TS shape.
- **Hash-routed filter in the static page**: `page.html` `#f-sig` filter and `?area=` opening; app counterpart `routes.tsx` search params.
- **Collapsible alert groups**: `page.html` alerts renderer (`<details>` per kind), `page.tsx Alerts`.
- **Router skill**: `/writing-for-agents` § SKILL-MECHANICS router pattern; `references/unsupported.md` as an existing branch target.

---

## Notes

- Django's default `verbose_name_plural` for a class with no `Meta.verbose_name` appends `s` (`entrys`); kept verbatim, the vocabulary renames.
- `resources.ts` tolerates a trailing slash so Django (`/api/invoices/`) and Nest (`/api/products`) paths match the same rule; the slug drops it.
- Derived capability ids start with `resource.` so a Map Rule or vocabulary id never collides.
- The queue line links to the app's `/queue`; the static page prints the count with no link unless `method.queueHref` is set at build.
- Phase 15 regenerates every golden; keep it last so Phases 10–14 diff only the files they touch.
- Proof table (fill at Phase 15): action-tracking coverage before 142 of 287 → after; alerts 196 → 0; unnamed capabilities before N → 0; first-party gaps 23 → M (listed with why).

## Resolved questions

1. Third-party handler: `handlerFile` (`review/src/inventory.ts`) null ⇒ third-party on Django and Symfony; on nestjs and spring every handler is first-party unless its prefix is a framework package. One `isFirstParty(handler, stack)` in `join.ts`.
2. Nest roles: the introspect reads the Adapted Script's Recognition Rules; a rule with `rawMetadata` matched on the row names the guard and the key. `ROLES_KEY` dropped. A decorator with no guard reading it stays `verdict null`.
3. Django default plural kept verbatim; the vocabulary renames.
4. `map check` prints per-area lines only for areas holding a capability; first-party gaps always listed in full.
5. ADR 0007 written in Phase 12 for map-side derived facts.

No unresolved questions.
