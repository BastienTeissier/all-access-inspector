# UF7: Inventory a Spring project

**Notion ticket:** *(not requested)*

## Context

A developer or auditor wants the same inventory for a Spring Boot project. This is a full rewrite: the existing Spoon-based static tool is replaced by a runtime Base Script that boots the context with a pinned profile.

## Specification

AAU (developer, with the project's build tool available), running the Spring Base Script (a test-scoped runner started through the project's Maven or Gradle wrapper, writing `tools/access-inspector/inventory.json`), I see:
- every mapping from `RequestMappingHandlerMapping`, one endpoint per HTTP method and path, with the handler as `file:line` of the controller method
- the global layer resolved from the `SecurityFilterChain` authorization rules: for each endpoint the first matching `requestMatchers` rule and its outcome (`permitAll` → `anonymous`, `authenticated` → `required`, `hasRole`/`hasAuthority`/`access` → `required` plus authorization `rule` with the raw expression), with the raw matcher kept
- the method layer from `@PreAuthorize`, `@PostAuthorize`, `@Secured`, `@RolesAllowed` on method, class, and one level of meta-annotation, all of them recorded, not only the first
- framework endpoints such as `/actuator/*` and `/error` classified like any other
- built-in rules for standard expressions (`isAuthenticated()`, `permitAll()`, `hasRole(...)`), and `unknown` for custom SpEL beans or custom `AuthorizationManager` implementations
- `stack: spring`, `discovery_mode: runtime`, `coverage: complete`

## Success Scenario

- AAU, the filter chain has `requestMatchers("/public/**").permitAll()` then `anyRequest().authenticated()`, I see `/public/*` endpoints as `anonymous` at layer `global` and everything else `required`.
- AAU, a controller method has `@PreAuthorize("hasRole('ADMIN')")` under an `authenticated()` matcher, I see authentication `required` at layer `global` and authorization `rule` at layer `method` with the raw expression.
- AAU, a mapping is declared on an interface the controller implements, I see it with the implementing class's handler location.

## Error Scenario

- AAU, the context fails to start with the pinned profile, I see the startup error and the profile, and no inventory is written.
- AAU, two filter chains overlap with `securityMatcher`, I see each endpoint resolved by the first chain whose matcher applies, as Spring does, and the chain named in the raw field.

## Edge Cases

- AAU, if the project has no Spring Security on the classpath, I see every endpoint `anonymous` at layer `framework-default`.
- AAU, if a `@PreAuthorize` calls a custom bean (`@permissionEvaluator.can(...)`), I see `unknown` for authorization until a Recognition Rule names it.
- AAU, if `@RolesAllowed({"USER","ADMIN"})` is used, I see the full list in the raw field, not only the first element.
- AAU, if the project is Kotlin, I see the same result, because discovery is runtime.

## Acceptance Criteria

- [ ] The Spring fixture (four controllers covering `@PreAuthorize`, `@Secured`, `@RolesAllowed`, class-level annotations, interface mappings, a filter chain with ordered matchers, actuator) matches its golden inventory byte for byte.
- [ ] Every mapping of the fixture appears once per method and path.
- [ ] Filter-chain outcomes are resolved per endpoint with the raw matcher kept.
- [ ] A custom SpEL bean call yields `unknown`.
- [ ] No Spoon or other source parser is used.
