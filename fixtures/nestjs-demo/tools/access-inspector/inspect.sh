#!/usr/bin/env bash
# Adapted Script entrypoint: tools/access-inspector/inspect.sh [--check | --table | --unknowns]
#   (no option)  write tools/access-inspector/inventory.json
#   --check      exit 1 with a per-endpoint diff when inventory.json is out of date; write nothing
#   --table      print a table; write nothing
#   --unknowns   print unknown endpoints as JSON lines; write nothing
# Exit codes: 0 ok, 1 drift (--check), 2 boot, rule, dimension or validation error.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$(dirname "$HERE")")"

usage() {
  echo "usage: tools/access-inspector/inspect.sh [--check | --table | --unknowns]" >&2
  exit 2
}

[ $# -le 1 ] || usage
case "${1:-}" in
  "") mode=write ;;
  --check) mode=check ;;
  --table) mode=table ;;
  --unknowns) mode=unknowns ;;
  *) usage ;;
esac

cd "$ROOT"
runner="$(node -e '
  const p = require("./package.json");
  const d = { ...p.dependencies, ...p.devDependencies };
  process.stdout.write(d.vitest ? "vitest" : d.jest ? "jest" : "");
')"
case "$runner" in
  vitest) args=(vitest run --config tools/access-inspector/vitest.config.ts) ;;
  # --forceExit: a provider holding a handle open must not keep jest alive once the result files are written.
  jest) args=(jest --config tools/access-inspector/jest.config.cjs --runInBand --ci --forceExit) ;;
  *)
    echo "access-inspector: package.json declares neither vitest nor jest; one of them runs the inspector" >&2
    exit 2
    ;;
esac

# The package manager owning the nearest lockfile, up to a monorepo root.
dir="$ROOT"
run=(npx --no-install)
while :; do
  if [ -f "$dir/pnpm-lock.yaml" ]; then run=(pnpm exec); break; fi
  if [ -f "$dir/yarn.lock" ]; then run=(yarn); break; fi
  if [ -f "$dir/bun.lock" ] || [ -f "$dir/bun.lockb" ]; then run=(bunx); break; fi
  if [ -f "$dir/package-lock.json" ] || [ "$dir" = / ]; then break; fi
  dir="$(dirname "$dir")"
done

out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
# The runner's own report stays off stdout; it is shown only when the harness never reported.
ACCESS_INSPECTOR_MODE="$mode" ACCESS_INSPECTOR_OUT="$out" "${run[@]}" "${args[@]}" >"$out/runner.log" 2>&1 || true
if [ ! -f "$out/status" ]; then
  cat "$out/runner.log" >&2
  echo "access-inspector: $runner stopped before the inspector reported; its output is above" >&2
  exit 2
fi
cat "$out/stdout"
cat "$out/stderr" >&2
exit "$(cat "$out/status")"
