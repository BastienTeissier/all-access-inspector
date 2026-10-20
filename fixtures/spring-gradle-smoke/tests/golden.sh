#!/usr/bin/env bash
# Golden-file test: the vendored Adapted Script runs through gradlew in a copy of this fixture. Needs a JDK 21;
# `make test-spring` runs it in a container.
set -uo pipefail

FIXTURE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PROJECT="$WORK/spring-gradle-smoke"
tar -C "$FIXTURE" --exclude=./build --exclude=./.gradle --exclude=./tests --exclude=./expected -cf - . | (mkdir -p "$PROJECT" && tar -C "$PROJECT" -xf -)

if ! "$PROJECT/tools/access-inspector/inspect.sh"; then
  echo "FAIL spring_gradle_golden: the inspector failed" >&2
  exit 1
fi
if ! diff "$FIXTURE/expected/inventory.json" "$PROJECT/tools/access-inspector/inventory.json"; then
  echo "FAIL spring_gradle_golden" >&2
  exit 1
fi
echo "ok   spring_gradle_golden"
