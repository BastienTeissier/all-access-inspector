# Spring reference

Tested with Spring Boot 4.1.1 (Spring Framework 7, Spring Security 7) on Spring MVC, built with Maven 3.9 and Gradle 9, on Java 21. Spring Security reads differ in older versions; the script fails with `Spring Security internals changed` rather than guessing (§ Blind spots).

## Vendor and run

Copy `<skill>/base-scripts/spring/tools/access-inspector/` into `tools/access-inspector/` (`cp -L` for `VERSION`), and `<skill>/base-scripts/spring/src/test/java/accessinspector/` into the project's test sources as `src/test/java/accessinspector/`. Never copy the toolkit's `pom.xml`, `mvnw`, `.mvn/` or `tests/`.

The project must have `spring-boot-starter-test` (JUnit 5, Mockito, the Spring test context) and Spring Security on its test classpath. A Gradle build needs `useJUnitPlatform()` on its `test` task.

`inspect.sh` runs the single test `accessinspector.AccessInspectorRun` through the project's own build: `mvnw` / `gradlew` found in the app root or a parent (a multi-module build), else `mvn` / `gradle` on `PATH`. The build gives the script the project's classpath. The mode and the output directory travel as the environment variables `ACCESS_INSPECTOR_MODE` and `ACCESS_INSPECTOR_OUT`; without them the test is skipped, so the project's own `mvn test` never runs it. The build's log is shown only when the build stops before the script reports (a compile error, a missing dependency).

`<inspect>` is always `tools/access-inspector/inspect.sh` from the module that holds the application class and its `pom.xml` / `build.gradle*`. In a multi-module build that is the application module, not the root.

## Where access is decided, by layer

| Layer | Spring construct | Read by the Base Script |
|---|---|---|
| `global` | a `SecurityFilterChain` bean: its `securityMatcher`, then the first `authorizeHttpRequests` entry matching the request | yes |
| `global` | a servlet `Filter` outside the chain, a `HandlerInterceptor` | no: write a `pathPrefix` rule |
| `class` | `@PreAuthorize`, `@PostAuthorize`, `@Secured`, `@RolesAllowed`, `@PermitAll`, `@DenyAll` on the controller | yes, when `@EnableMethodSecurity` turns the family on |
| `method` | the same annotations on the handler method, or on the interface method it implements | yes |
| `framework-default` | no `SecurityFilterChain` matches the request | yes, `builtin:no_chain` |

The chain is decided as Spring Security decides it: chains in their `@Order`, the first whose `securityMatcher` matches the sample request (every path variable filled with `1`), then its first matching entry. No entry matching is `denyAll`. A chain without `authorizeHttpRequests` is `builtin:no_authorization` (anonymous). `raw` reads `<chain bean>: <matcher> -> <check>`, e.g. `api: PathPattern [GET /api/catalog/**] -> permitAll`.

Method security is read per family, as Spring's interceptors apply them: the method's annotation of a family wins over the class's, and every active family applies. `@PreAuthorize` and `@PostAuthorize` count only with `@EnableMethodSecurity`, `@Secured` with `securedEnabled = true`, the JSR-250 annotations with `jsr250Enabled = true`; an annotation whose family is off is ignored, as at runtime.

Handlers are named `<fully.qualified.Class>.<method>`, not `file:line`: the class is what the context holds.

## Production entry

1. `@SpringBootTest(classes = …)` on `Boot` names the application class production runs, the one `main` passes to `SpringApplication.run`. Left out, Spring finds the `@SpringBootConfiguration` above package `accessinspector`, which may be a test configuration: always name it.
2. `@ActiveProfiles` on `Boot` is the profile production runs with, `PROFILE_REASON` says where that is set (a Dockerfile `SPRING_PROFILES_ACTIVE`, a Helm value, the deployment manifest). Ask when nothing in the repository says it. A project with no production profile keeps `@ActiveProfiles("default")`.
3. The context boots as a MOCK web environment: no port opens, but the `DispatcherServlet`, the filter chains and the actuator's web endpoints are those of production.

## Environment

`PINNED` properties go through `@DynamicPropertySource`, which overrides `application*.yml`, environment variables and system properties. Pin every property that shapes chains, matchers, actuator exposure or routes (`management.endpoints.web.exposure.include`, `server.servlet.context-path`, `spring.mvc.servlet.path`, a feature flag guarding a controller) to its production value; ask when the source does not say. The profile is never a pin: set it with `@ActiveProfiles`.

The shell's environment is not cleared: an `APP_*` variable set on a developer's machine still binds. Pin what shapes access so the inventory does not depend on it.

## Boot failure → stub cookbook

The script prints the deepest cause after `cannot boot <application class> with profile <profile>:`.

| Symptom | Toward-production fix |
|---|---|
| `Could not resolve placeholder 'app.jwt-secret'`, a missing `@ConfigurationProperties` value | `new Pin("app.jwt-secret", "inventory-placeholder", "secret required at boot by src/main/java/…/SecurityConfig.java:19")`, never a real value |
| A required non-secret value (a URL, an allowed origin) | a `Pin` with a production-shaped placeholder; ask the user when it changes routes or matchers |
| A `DataSource`, JPA or Flyway failing to connect | `Pin` `spring.datasource.url` to an H2 URL only when the driver is on the test classpath; else `@MockitoBean @Reason("database unreachable outside production") DataSource dataSource;` and pin `spring.jpa.hibernate.ddl-auto=none`, `spring.flyway.enabled=false` |
| A bean connecting in its constructor or `@PostConstruct` (a gateway client, Redis, Kafka) | `@MockitoBean @Reason("payment gateway reachable from production only") PaymentClient payments;` |
| A `SecurityFilterChain`, `AuthorizationManager`, `PermissionEvaluator`, a controller or the application class | never stub: `Boot` refuses. Stub what it depends on instead |
| A bean named in a SpEL expression (`@permissions.canRead(#id)`) | stub what it depends on, never the bean: its code is what a Recognition Rule reads |
| `ClassNotFoundException`, `NoSuchMethodError` | a dependency missing from the test classpath, or a version clash: report it |

A `@MockitoBean` field replaces the bean of its type in the context; its stubbed methods return defaults. `Boot` refuses a stub without `@Reason` and the access-shaping types above; the rest (stubbing only toward production) is on you.

## Built-in rules

| Construct | authentication | authorization |
|---|---|---|
| no matching chain (`no_chain`), a chain without `authorizeHttpRequests` (`no_authorization`) | anonymous | none |
| `permitAll()`, `@PermitAll`, SpEL `permitAll()` | anonymous | none |
| `authenticated()`, `fullyAuthenticated()`, `rememberMe()`, SpEL `isAuthenticated()` / `isFullyAuthenticated()` | required | none |
| `hasRole`, `hasAnyRole`, `hasAuthority`, `hasAnyAuthority` (Java or SpEL with quoted literals), `@Secured`, `@RolesAllowed` | required | rule |
| `denyAll()`, `@DenyAll`, no entry matching | required | rule |

A SpEL expression is a Built-in Rule only when it is one such call with quoted literal arguments: `hasRole('ADMIN')` is, `hasRole(ADMIN)` (a bean or a variable named `ADMIN`), `hasRole('A') and #id == 1` and `@permissions.canRead(#id)` are not. Every other check (`access(…)` with a custom `AuthorizationManager` or a lambda, `hasIpAddress`, a bean call) is unknown until a Recognition Rule names it. A lambda reads as `lambda in <declaring class>`.

## Writing a Recognition Rule

- `construct` is the check exactly as `--unknowns` shows it: after `-> ` in `raw` for the filter chain (`access("hasIpAddress('10.0.0.0/8')")`, `lambda in com.acme.SecurityConfig`), the whole `raw` for an annotation (`@PreAuthorize("@permissionEvaluator.canRead(#id)")`).
- `evidence` is the line of the method the expression calls (`PermissionEvaluator.java:10`), or of the `AuthorizationManager`'s `check`/`authorize`, or for a lambda the line that declares it.
- A check that lets reads through (`request.getMethod().equals("GET")`): `.safe("anonymous", "none")`.
- A servlet filter or interceptor enforcing a prefix: `Rule.pathPrefix(name, evidence, "/partner/", "global", "required", "none").raw("<FilterClass>")`, with the full path (context path excluded, § Blind spots) and evidence on the line that rejects the request.

## Acknowledged Unknowns

- A check deciding from the request body, the loaded entity or `@PostAuthorize` on the returned object: acknowledge its `construct`.
- `hasIpAddress`, a network allow-list: acknowledge it with where the network rule lives.
- GraphQL (`/graphql`), WebSocket and STOMP endpoints, RSocket: acknowledge the `path`; operations are out of scope.
- An external policy engine (OPA, a permission service): acknowledge the construct.

## Blind spots

- The chain is decided for one sample request per endpoint, its variables filled with `1`. A matcher more specific than the mapping (`/api/users/1/**`, a regex, a `RequestHeaderRequestMatcher`, a dispatcher type) can decide other requests to the same endpoint differently. Read the chain's matchers when one is not a plain path pattern.
- `server.servlet.context-path` is not part of the paths: they are what the application sees, as the matchers see them.
- Functional routes (`RouterFunction` beans) are not listed: `coverage` is `best-effort` and `coverage_note` says so. WebFlux applications are not read at all.
- Static resources (`/static/**`, `/webjars/**`) and the default servlet are not listed; check their chain entry by hand when they hold more than assets.
- Spring Security on the classpath is required; a project securing endpoints only with a servlet filter or interceptor reads `no_chain` everywhere until `pathPrefix` rules name them.
- Checks inside handlers or services (`if (!user.isAdmin()) throw new AccessDeniedException(…)`) are invisible. Grep handlers flagged `anonymous` or `none` for `AccessDeniedException`, `ResponseStatusException(FORBIDDEN`, `SecurityContextHolder`, `@AuthenticationPrincipal`.
- `inspect.sh` builds one module. In a multi-module build, run it from each application module.
- The script reads Spring Security's internals by reflection (the `RequestMatcherDelegatingAuthorizationManager` entries and the managers' fields). When a version moves them, the endpoints show `unknown` with `Spring Security internals changed: <exception>: …`: report it to the toolkit, never write rules around it. A `NoSuchFieldException` or `InternalsChanged` is a moved internal; any other exception there may be a bug in the script itself.

## Triage checklist

Read each handler in the Triage scope (`SKILL.md` § Triage) for what the inventory cannot see. Raise a Signal on the first item that holds; otherwise mark it `triaged`.

- **Name and verb against the check.** A handler named `delete*`, `approve`, `export`, `impersonate` or `refund` with `required/none` or an `anonymous` write is a Signal. So is a `@PutMapping` or `@PatchMapping` that any signed-in user reaches on an entity whose `@PostMapping` is restricted by role: raise it on the open handler.
- **HEAD and GET-only matchers.** `requestMatchers(HttpMethod.GET, …)` does not match HEAD or OPTIONS; the inventory shows it. Raise a Signal only when that leaves a write reachable.
- **Checks in the handler or its service.** `@AuthenticationPrincipal` compared to the entity, `throw new AccessDeniedException()`, an owner filter in the repository call (`findByIdAndOwner`): follow the call one level into the service and say whether it covers every route of the handler.
- **Lookups by id.** A `findById(id)` / `getReferenceById(id)` on a `{id}` path with no owner or tenant in the query is a Signal: any signed-in user reads any row.
- **Bulk and export.** A response streaming many rows (`StreamingResponseBody`, CSV, a `Pageable` with no maximum size) on an `anonymous` or `required/none` endpoint is a Signal.
- **Anonymous writes.** Name what an anonymous write changes. Login, signup, password reset and webhooks verified by signature are expected: mark them `triaged`.
- **Actuator.** Every exposed actuator endpoint other than `health` and `info` reachable without a role is a Signal (`env`, `heapdump`, `loggers`, `shutdown`).
- **Third-party handler** (`org.springframework.*`, a library controller): read the configuration that exposes it for a check the inventory missed; otherwise skip it.

Evidence is the line that shows the problem (`src/main/java/com/acme/orders/OrderService.java:41`), not the handler's first line.

## Candidate dimensions

As for any stack: path prefix groups that share a chain or an entry (`/api/admin/`, `/actuator/`, `/partner/`), roles named in checks (`hasRole('ADMIN')` → `staff`), `permitAll` entries → `public`. `RULES` are Java predicates on the endpoint: `new Assign("access_tier", "staff", e -> e.path().startsWith("/api/admin/"))`.

Each value then gets an expected access in `EXPECTED`, keyed like `DIMENSIONS`. Typical: `public` anonymous or optional, none; `customer` required, none or rule; `staff` required, rule.

## Linters

Exclude `src/test/java/accessinspector/` from Checkstyle (`<excludes>` or a suppression), PMD and SpotBugs (`excludeFilterFile`), Spotless (`targetExclude`), and from JaCoCo coverage thresholds (`<excludes>accessinspector/**</excludes>`). The vendored files follow the toolkit's style, not the project's.
