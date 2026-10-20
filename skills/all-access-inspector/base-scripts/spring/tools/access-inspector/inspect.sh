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

# The build of this project: its wrapper, or the one of the multi-module build it belongs to, else the tool on PATH.
build=""
dir="$ROOT"
while :; do
  if [ -f "$ROOT/pom.xml" ] && [ -x "$dir/mvnw" ]; then build=maven; tool="$dir/mvnw"; break; fi
  if [ -f "$ROOT/build.gradle" ] || [ -f "$ROOT/build.gradle.kts" ]; then
    if [ -x "$dir/gradlew" ]; then build=gradle; tool="$dir/gradlew"; break; fi
  fi
  if [ "$dir" = / ]; then break; fi
  dir="$(dirname "$dir")"
done
if [ -z "$build" ]; then
  if [ -f "$ROOT/pom.xml" ] && command -v mvn >/dev/null; then build=maven; tool=mvn;
  elif { [ -f "$ROOT/build.gradle" ] || [ -f "$ROOT/build.gradle.kts" ]; } && command -v gradle >/dev/null; then build=gradle; tool=gradle;
  else
    echo "access-inspector: no mvnw, gradlew, mvn or gradle builds $ROOT; one of them runs the inspector" >&2
    exit 2
  fi
fi
case "$build" in
  maven) args=(-B -f "$ROOT/pom.xml" test -Dtest=accessinspector.AccessInspectorRun -Dsurefire.failIfNoSpecifiedTests=false) ;;
  # --rerun: the inspector's inputs are the code and the environment, which Gradle's up-to-date check does not see.
  gradle) args=(-p "$ROOT" test --tests accessinspector.AccessInspectorRun --rerun) ;;
esac

out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
# The build's own report stays off stdout; it is shown only when the harness never reported.
(cd "$ROOT" && ACCESS_INSPECTOR_MODE="$mode" ACCESS_INSPECTOR_OUT="$out" "$tool" "${args[@]}") >"$out/build.log" 2>&1 || true
if [ ! -f "$out/status" ]; then
  cat "$out/build.log" >&2
  echo "access-inspector: $build stopped before the inspector reported; its output is above" >&2
  exit 2
fi
cat "$out/stdout"
cat "$out/stderr" >&2
exit "$(cat "$out/status")"
