# UF8: Inventory a Symfony project

**Notion ticket:** *(not requested)*

## Context

A developer or auditor wants the inventory for a Symfony project, with or without API Platform. The Base Script grows Accent's router walk to cover the layers Accent ignores.

## Specification

AAU (developer, with the project's Composer dependencies installed), running the Symfony Base Script (a script booting the kernel with a pinned env and writing `tools/access-inspector/inventory.json`), I see:
- every route of the router, one endpoint per HTTP method and path, with the handler as `file:line` of the controller method or the API Platform operation declaration
- the global layer from `security.yaml`: firewall and `access_control` rules resolved per path and method, first match wins, raw rule kept (`PUBLIC_ACCESS` → `anonymous`, `IS_AUTHENTICATED_FULLY`/`ROLE_*` → `required` plus `rule` when a role is required)
- the class and method layer from `#[IsGranted]` and `#[Security]` attributes, expressions kept raw
- API Platform operations with their `security` expression, including the resource-level one inherited by the operation
- `unknown` for authorization enforced by voters or `denyAccessUnlessGranted` inside handler bodies, with the construct named in the reason
- `stack: symfony`, `discovery_mode: runtime`, `coverage: complete`

## Success Scenario

- AAU, `access_control` has `{ path: ^/admin, roles: ROLE_ADMIN }` and a controller under `/admin` has no attribute, I see authentication `required` and authorization `rule` at layer `global`.
- AAU, an API Platform resource has `security: "is_granted('ROLE_USER')"` and one operation overrides it, I see the override on that operation and the resource expression on the others.
- AAU, a controller calls `$this->denyAccessUnlessGranted('EDIT', $post)`, I see `unknown` with reason "voter check in handler body".

## Error Scenario

- AAU, the kernel fails to boot with the pinned env, I see the error and the env, and no inventory is written.
- AAU, API Platform is installed but its metadata factory is unavailable, I see the API Platform routes with `unknown` and a reason, not a crash.

## Edge Cases

- AAU, if a route has no HTTP method restriction, I see a single endpoint with method `ANY`.
- AAU, if `api_doc` and `api_entrypoint` are exposed, I see them as ordinary endpoints, with no special treatment.
- AAU, if the project has no security bundle, I see every endpoint `anonymous` at layer `framework-default`.

## Acceptance Criteria

- [ ] The Symfony fixture (controllers with and without attributes, `access_control` rules, an API Platform resource with operation override, a voter call) matches its golden inventory byte for byte.
- [ ] Every route of the fixture appears once per method and path.
- [ ] `access_control` outcomes are resolved per endpoint with the raw rule kept.
- [ ] Voter checks yield `unknown` with a reason.
- [ ] Non-API-Platform routes are classified, not labelled "not API Platform".
