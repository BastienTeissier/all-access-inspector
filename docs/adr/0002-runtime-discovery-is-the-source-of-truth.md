# Runtime discovery is the source of truth; static analysis only when routing cannot be enumerated

The claim "all endpoints the application exposes" can only be proven from the route table the framework actually serves: routers, includes, admin, generated API operations and config-driven security are invisible to source parsing. We decided that a Base Script boots the application in a pinned, production-like environment and reads the framework's route table. Static (source-level) discovery is admissible for a project only when its routing layer cannot be enumerated at runtime, and the inventory then states that its coverage is best effort. "The application is hard to boot" is never an admissible reason; solving the boot is the Agent's job.

## Considered options

- **Static analysis everywhere** (the approach of spring-access-inspector, built on Spoon): rejected because it cannot see `SecurityFilterChain`, generated routes or anything config-driven, which is exactly the coverage gap this project exists to close.
- **Per-stack choice** (runtime for Django and Symfony, static for Spring): rejected because it would give every Spring project the weak claim even when it boots fine.

## Consequences

- The existing Spoon-based Spring tool is not carried forward; the Spring Base Script is a runtime dump of the handler mappings and the security filter chain.
- Every Adapted Script pins its Boot Environment, and stubs may change a routing-shaping setting only to move it toward production.
