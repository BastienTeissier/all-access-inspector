# The Agent fits once; the Adapted Script runs without it

We want a stack-agnostic way to list every exposed endpoint with its authentication and authorization, and we want that list to be deterministic enough to gate CI. An LLM agent cannot be in the audit path for that. We decided that the Agent is a setup-time tool only: it copies a stack's Base Script into the project, adapts it (boot environment, recognition rules, project dimensions) and the resulting Adapted Script is committed into the audited repository. From then on, the inventory is produced by the Adapted Script alone, on any machine, with no LLM.

## Considered options

- **Agent runs every audit**, patching and running the base script each time: rejected because the inventory would not be reproducible and CI could not gate on it.
- **Fixed script discovers, agent interprets**: what the django-access-inspector skill does today; rejected because the "unchecked" bucket stays unsolved and the agent's interpretation is non-deterministic.

## Consequences

- A Base Script bug fix reaches a project only when the Agent is re-run against it.
- The human review of the Adapted Script commit is the trust gate: every recognition rule the Agent writes must cite the file and line it interprets.
