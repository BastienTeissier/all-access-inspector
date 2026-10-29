# All Access Inspector

A stack-agnostic toolkit that lets a developer produce, deterministically and without an LLM in the loop, the complete inventory of the HTTP endpoints their application exposes together with each endpoint's authentication and authorization. An agent is used only to fit the toolkit to a given project.

## Language

**Base Script**:
A stack-specific, project-agnostic program shipped with this toolkit that produces an Endpoint Inventory for a conventional project on that stack.
_Avoid_: template, scanner, inspector

**Adapted Script**:
A copy of a Base Script that the Agent has modified for one project and that is committed into that project's repository; it is the only thing that runs afterwards.
_Avoid_: generated script, patched script

**Agent**:
The LLM-driven process that fits a Base Script to a project, producing the Adapted Script. It is a setup-time tool, not part of the audit run.

**Endpoint Inventory**:
The deterministic output of an Adapted Script: every exposed endpoint with its authentication and authorization, stamped with the Discovery Mode that produced it.
_Avoid_: report, scan result, findings

**Committed Inventory**:
The Endpoint Inventory file committed next to the Adapted Script; CI regenerates the inventory and fails on any difference, so every access-control change appears as a reviewable diff.
_Avoid_: snapshot, baseline

**Boot Environment**:
The settings, profiles, flags and stubs the Adapted Script boots the application with; pinned in the Adapted Script so the inventory does not depend on where it runs. It is production-like: stubs may replace secrets, databases and external services, and may change a routing-shaping setting only to move it toward production.

**Discovery Mode**:
How an Adapted Script enumerates endpoints: **runtime** (reads the route table of the booted application) or **static** (recognises routes in source code).
_Avoid_: analysis type, strategy

**Runtime Discovery**:
The preferred Discovery Mode; its inventory claims completeness because the framework itself reports what it mounts.

**Static Discovery**:
The fallback Discovery Mode; its inventory claims only best effort. Admissible for a project solely when its routing layer cannot be enumerated at runtime, never because the application is hard to boot.

### Inventory contents

**Endpoint**:
One HTTP method (or `ANY` when the handler declares no restriction) on one path pattern served by one handler; identified by the triple (method, path pattern, handler location), never by a route name. Anything that answers an HTTP request is an Endpoint, framework-provided routes included; there is no side bucket.
_Avoid_: route, view, URL, operation

**Core Classification**:
The closed, stack-agnostic vocabulary every endpoint in an Endpoint Inventory carries: authentication (`anonymous`, `optional`, `required`, `unknown`), authorization (`none`, `rule`, `unknown`), and the layer that established each (`global`, `class`, `method`, `framework-default`). The raw framework expression is kept beside it. The Agent may never alter this vocabulary.
_Avoid_: normalised fields, severity, verdict

**Built-in Rule**:
A mapping shipped with a Base Script from a framework-provided construct (for example DRF's `IsAuthenticated`) onto the Core Classification; applied per HTTP method.

**Recognition Rule**:
An addition the Agent makes to an Adapted Script so that a project-specific construct (custom decorator, permission class, middleware, annotation) is mapped onto the Core Classification instead of yielding `unknown`. Same mechanism as a Built-in Rule, but it is an Agent claim and must cite Evidence.
_Avoid_: patch, override

**Project Dimension**:
A label set defined by the project (for example `public`, `customer`, `back-office`) that the Adapted Script declares, with its allowed values, and assigns to every endpoint beside the Core Classification.
_Avoid_: custom field, tag, category

**Unknown**:
The Core Classification value an Adapted Script must emit when it cannot establish a fact; endpoints are never silently dropped or guessed.

**Acknowledged Unknown**:
An Unknown that the Adapted Script carries a written reason for; the only kind allowed to remain once fitting is complete.
_Avoid_: ignored, baselined, suppressed

**Evidence**:
The source location (file and line) of the project construct a Recognition Rule interprets, cited in the Adapted Script so a reviewer can verify the rule.

### Review

**Review Log**:
The append-only file of review events committed next to the Committed Inventory (`reviews.jsonl`); events are never edited or deleted, and the current state of every review is obtained by replaying it against the current inventory.
_Avoid_: baseline, review database

**Review Key**:
How a review event names an Endpoint: method, path pattern and handler location with any line number stripped, so moving a handler within its file keeps its reviews.

**Verdict**:
A human's judgement on one Endpoint, given on the Core Classification it had at the time: `safe` (access is correct for what the endpoint does), `accepted` (a known weakness kept deliberately, optionally until a date) or `finding` (must be fixed). Only a human gives a Verdict.
_Avoid_: approval, status, baseline

**Outdated Verdict**:
A Verdict that no longer holds because its Endpoint changed. Inside its expected access, an Endpoint invalidates a Verdict when its authentication or authorization value differs from the one reviewed; outside its expected access, any change to the reviewed classification does. Derived on replay, never written as an event. An `accepted` Verdict past its date is outdated too.

**Orphaned Verdict**:
A Verdict whose Review Key no longer matches any Endpoint in the inventory. Kept as history, never re-attached automatically.

**Signal**:
A reason to look at an Endpoint first. A deterministic Signal is computed from the inventory alone and never stored; an agent Signal comes from the Agent reading the handler, is stored in the Review Log, and is advisory only.

**Triage**:
An on-demand Agent run that reads the handlers of unreviewed, non-`rule` Endpoints and appends agent Signals, or a record that it found nothing. It never gives a Verdict.

**Review Queue**:
Every Endpoint without a valid Verdict, ordered by its highest Signal tier, then path and method.

### Access map

**Access Map**:
The page that shows, per **Role** and per **Capability**, whether the role passes, how far its reach goes, and on what **Basis**. A view of the review app, also exported as one static page; it decides nothing the **Map Runtime**, the **Map Vocabulary** and the **Review Log** do not hold.
_Avoid_: role matrix, permission matrix

**Role**:
Who a request can be, as the project's code defines it: a group, a role constant, a `ROLE_*`, the superuser bypass. Extracted from the code with the `file:line` that defines it, and named after the project's docs when they define it. Not signed in is the one role the toolkit always adds, since the inventory proves it per endpoint.
_Avoid_: profile, persona, user type

**Role kind**:
How a **Role** is compared with what an endpoint lets through: `signed_in` (an account with no role), `superuser` (passes every check), `group` (anything else). Chosen per role from evidence, never from a default list.

**Capability**:
One thing a role can do in the domain's words ("Upload scanned cards"), with the endpoints that action spans. Extracted first (an admin model action, a resource verb); the Agent only names, groups and adds what no program can read. Every endpoint is meant to sit behind one.

**Area**:
A group of **Capabilities** around one domain term. The term comes from `CONTEXT.md` when the project has one, else from the code or the docs, with its `file:line`.

**Scope**:
How far a role's reach goes over the records once it passes: every record, or what a filter in the code leaves (own subsidiary, own records). Never proved by a program, so never shown as read from the code.

**Cell**:
One **Capability** for one **Role**: passes, partial, does not pass, switched off, or not resolved; plus its **Scope** and **Basis**. Computed, never written.

**Partial capability**:
A **Cell** where the role reaches some of the capability's endpoints and not others. A possible leak or a bug until a human decides it.

**Basis**:
Where a fact on the map was read: `extracted` (the base introspect), `rule` (a **Map Rule** or a Recognition Rule), `inferred` (a heuristic), `curated` (hand-written in the **Map Vocabulary**), `open` (not resolved). A cell takes the weakest basis it rests on.

**Map Introspect**:
The per-stack script, vendored like the Adapted Script, that boots the app and writes the **Map Runtime**. Its project section holds the **Map Rules**; the rest stays byte-identical to the toolkit's.

**Map Rule**:
Project code in the **Map Introspect** that reads roles, grants, scopes, role inclusions or capabilities from where the code declares them, each fact with its `file:line`. The access-map counterpart of a Recognition Rule, reviewed the same way.

**Map Runtime**:
`tools/access-map/runtime.json`: what the **Map Introspect** read. Committed and byte-stable, so a change in who passes shows in a diff.

**Map Vocabulary**:
`tools/access-map/vocabulary.json`: what no program can read, written by the Agent with the user, each entry with the reason it was not extracted and every `file:line` pinned to its line.

**Capability Decision**:
A human's judgement on one **Cell**, in the **Review Log** with the same verdicts as a **Verdict** (`safe`, `accepted`, `finding`). Outdated when the cell's reach changes.

## Relationships

- One **Base Script** exists per supported stack
- An **Adapted Script** derives from exactly one **Base Script** and belongs to exactly one project
- Running an **Adapted Script** yields one **Endpoint Inventory**; running it twice on the same commit yields the same **Endpoint Inventory**
- The **Agent** produces **Adapted Scripts** and never produces an **Endpoint Inventory** directly
- A stack may ship one **Base Script** per **Discovery Mode**; the **Agent** picks **Runtime Discovery** unless the project's routing layer cannot be enumerated, and records the reason in the **Adapted Script** when it falls back to **Static Discovery**
- Every **Endpoint Inventory** states its **Discovery Mode** and its coverage (`complete` for Runtime Discovery on a supported stack, `best-effort` otherwise)
- For a stack with no **Base Script**, the **Agent** improvises from the closest one and the inventory is `best-effort`
- One **Adapted Script** and one **Committed Inventory** per bootable application; a repository with several applications has several, never merged
- Operations inside a single-endpoint protocol (GraphQL, WebSockets) are not **Endpoints**; the transport route is, with an **Acknowledged Unknown** on authorization
- Every endpoint carries a **Core Classification**; it may also carry one value per **Project Dimension**
- **Built-in Rules** and **Recognition Rules** feed the **Core Classification**; **Project Dimensions** never replace it
- An identity check alone (`IsAuthenticated`, `login_required`) sets authentication to `required` and authorization to `none`; authorization is `rule` only when something beyond identity is checked
- A project-specific construct with no **Recognition Rule** is **Unknown**, however suggestive its name
- The **Endpoint Inventory** records facts only; whether an endpoint is a problem is decided downstream
- Fitting is complete when every remaining **Unknown** is an **Acknowledged Unknown**
- An **Endpoint Inventory** is byte-stable: sorted, free of timestamps and absolute paths, so the **Committed Inventory** diff is meaningful
- An **Adapted Script** pins its **Boot Environment**; an endpoint that exists only under some flags is a diff for a reviewer, not an environment variant
- Every **Recognition Rule** cites its **Evidence**; the human review of the **Adapted Script** commit is the trust gate
- A **Verdict** never changes the **Core Classification** or the **Committed Inventory**; facts and judgements are kept apart
- A **Verdict** covers only the **Endpoints** that existed when it was given; a bulk review writes one event per **Endpoint**, never a selector
- A `finding` closes only through an **Outdated Verdict** followed by a new `safe` one
- An **Endpoint** leaves the **Review Queue** only through a human **Verdict**; **Triage** finding nothing does not take it out
- A fact about access the code declares in a form a program can read is read by a **Map Rule**, never written into the **Map Vocabulary**
- A **Role** exists on the **Access Map** only if the code defines it; a role the docs name and the code does not is reported, never invented
- A **Partial capability** stays an alert until a **Capability Decision** that is not outdated covers it
- The **Access Map** never changes the **Committed Inventory**, the **Map Runtime** or a **Verdict**

## Flagged ambiguities

- "role" named both a group the code checks and a step of a business workflow (moi: Production Manager, the workflow's PM): resolved, a **Role** is what the code checks; a workflow role is a role only when the code checks it.

- "the project ontology" for roles and capabilities: resolved as `CONTEXT.md` when it exists, else terms read from the code and the docs with their `file:line`; the Agent never writes the project's `CONTEXT.md`.

- The existing Django tool identifies endpoints by URL name and drops unnamed views: rejected, an **Endpoint** is identified by method, path pattern and handler location.

- "the user's vocabulary in the output" could mean recognising project constructs (input side) or emitting project labels (output side): resolved as both, via **Recognition Rules** and **Project Dimensions**, with the **Core Classification** closed.

- "runtime not possible" was first read as "the app is hard to boot": resolved, a hard boot is the Agent's job to solve, not a reason for Static Discovery. The only admissible reason is that the routing layer cannot be enumerated.

- "deterministic" and "agent" were used together: resolved by placing the determinism boundary at the Adapted Script. The Agent's work is non-deterministic but happens once, at setup; the audit itself is Agent-free.

- "manage the baseline" could mean editing the inventory's facts or recording human judgements on them: resolved as the latter, the **Review Log**; the **Committed Inventory** stays tool-written.

## Example dialogue

> **Dev:** "The **Agent** flagged our `IsTenantMember` permission class as **Unknown**, but the name says what it does. Can't it just map it?"
> **Security lead:** "No. Its name is not **Evidence**. The **Agent** reads the class, writes a **Recognition Rule** citing the file and line, and you review that rule in the **Adapted Script** commit. After that the **Committed Inventory** shows `authorization: rule` for every endpoint using it."
> **Dev:** "And our `/api/` prefix is behind the tenant middleware, so everything there is at least `customer` for us."
> **Security lead:** "That becomes a **Recognition Rule** setting authentication `required` at layer `global` in the **Core Classification**, plus a **Project Dimension** value `customer`. The core says what is enforced, the dimension says what you call it."
