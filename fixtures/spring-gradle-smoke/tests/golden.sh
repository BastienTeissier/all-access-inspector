#!/usr/bin/env bash
# Golden-file test: the vendored Adapted Script runs through gradlew in a copy of this fixture. Needs a JDK 21;
# `make test-spring` runs it in a container.
set -uo pipefail

FIXTURE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_SCRIPT="$FIXTURE/../../skills/all-access-inspector/base-scripts/spring"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PROJECT="$WORK/spring-gradle-smoke"
tar -C "$FIXTURE" --exclude=./build --exclude=./.gradle --exclude=./tests --exclude=./expected -cf - . | (mkdir -p "$PROJECT" && tar -C "$PROJECT" -xf -)
failures=0

if ! "$PROJECT/tools/access-inspector/inspect.sh"; then
  echo "FAIL spring_gradle_golden: the inspector failed" >&2
  failures=$((failures + 1))
elif ! diff "$FIXTURE/expected/inventory.json" "$PROJECT/tools/access-inspector/inventory.json"; then
  echo "FAIL spring_gradle_golden" >&2
  failures=$((failures + 1))
else
  echo "ok   spring_gradle_golden"
fi

strip() {
  # a file without its project sections
  sed '/\/\/ --- project ---/,/\/\/ --- end project ---/d' "$1"
}

drift=0
for dir in tools/access-inspector src/test/java/accessinspector; do
  [ "$(ls "$FIXTURE/$dir")" = "$(ls "$BASE_SCRIPT/$dir")" ] || { echo "    $dir lists $(ls "$FIXTURE/$dir" | tr '\n' ' ')" >&2; drift=1; }
  for name in $(ls "$BASE_SCRIPT/$dir"); do
    [ "$(strip "$FIXTURE/$dir/$name")" = "$(strip "$BASE_SCRIPT/$dir/$name")" ] || { echo "    $dir/$name differs from the Base Script" >&2; drift=1; }
  done
done
if [ "$drift" = 0 ]; then echo "ok   spring_gradle_vendored_copy_matches_the_base_script"; else echo "FAIL spring_gradle_vendored_copy_matches_the_base_script"; failures=$((failures + 1)); fi
[ "$failures" = 0 ] || exit 1
