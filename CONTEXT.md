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

## Flagged ambiguities

- The existing Django tool identifies endpoints by URL name and drops unnamed views: rejected, an **Endpoint** is identified by method, path pattern and handler location.

- "the user's vocabulary in the output" could mean recognising project constructs (input side) or emitting project labels (output side): resolved as both, via **Recognition Rules** and **Project Dimensions**, with the **Core Classification** closed.

- "runtime not possible" was first read as "the app is hard to boot": resolved, a hard boot is the Agent's job to solve, not a reason for Static Discovery. The only admissible reason is that the routing layer cannot be enumerated.

- "deterministic" and "agent" were used together: resolved by placing the determinism boundary at the Adapted Script. The Agent's work is non-deterministic but happens once, at setup; the audit itself is Agent-free.

## Example dialogue

> **Dev:** "The **Agent** flagged our `IsTenantMember` permission class as **Unknown**, but the name says what it does. Can't it just map it?"
> **Security lead:** "No. Its name is not **Evidence**. The **Agent** reads the class, writes a **Recognition Rule** citing the file and line, and you review that rule in the **Adapted Script** commit. After that the **Committed Inventory** shows `authorization: rule` for every endpoint using it."
> **Dev:** "And our `/api/` prefix is behind the tenant middleware, so everything there is at least `customer` for us."
> **Security lead:** "That becomes a **Recognition Rule** setting authentication `required` at layer `global` in the **Core Classification**, plus a **Project Dimension** value `customer`. The core says what is enforced, the dimension says what you call it."
