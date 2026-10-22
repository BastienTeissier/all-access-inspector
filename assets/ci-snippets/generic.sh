#!/usr/bin/env sh
# Access Inspector: fail the build when the Committed Inventory no longer matches the code.
# Template filled by the Agent, then proposed to the project as tools/access-inspector/ci-snippet.sh:
#   {{install}} the project's own install command; nothing outside its stack
#   {{check}}   the stack's check command, e.g. python tools/access-inspector/inspect.py --check
# Exit 1: inventory drift, with a per-endpoint diff.
# Exit 2: no inventory could be produced or read (boot failure, invalid rules or dimensions,
#         missing or corrupt inventory.json).
set -eu
{{install}}
{{check}}
