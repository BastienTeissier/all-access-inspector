# The Adapted Script is a vendored copy, not a dependency

The Agent needs freedom to edit code (boot stubs, recognition rules for arbitrary project constructs), and the audited project must be able to regenerate its inventory with nothing installed beyond its own stack. We decided that the Agent copies the Base Script's files into the project (for example `tools/access-inspector/`) and edits them in place; the project owns that copy.

## Considered options

- **Published package plus a configuration file of rules**: rejected because a rule language rich enough for real projects ("this middleware authenticates everything under this prefix except these paths") becomes a worse programming language.
- **Published package plus a code hook** that registers rules: a reasonable second step once a Base Script is stable; nothing in the vendored approach blocks moving to it.

## Consequences

- Upgrades are manual: a project gets a newer Base Script only by re-running the Agent.
- A reader finding inspector code inside a product repository should not "fix" it into a dependency.
