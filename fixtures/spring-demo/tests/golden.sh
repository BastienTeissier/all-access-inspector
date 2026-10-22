#!/usr/bin/env bash
# Golden-file tests: run the vendored Adapted Script inside a copy of this fixture. Needs a JDK 21; `make test-spring`
# runs it in a container.
set -uo pipefail

FIXTURE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_SCRIPT="$FIXTURE/../../skills/all-access-inspector/base-scripts/spring"
EXPECTED="$FIXTURE/expected/inventory.json"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PROJECT="$WORK/spring-demo"
OUTPUT="$PROJECT/tools/access-inspector/inventory.json"
# One copy for every test, so Maven compiles it once; each test restores what it edits.
tar -C "$FIXTURE" --exclude=./target --exclude=./tests --exclude=./expected -cf - . | (mkdir -p "$PROJECT" && tar -C "$PROJECT" -xf -)

failures=0
status=0 stdout="" stderr=""

run() {
  local cwd="$PROJECT"
  if [ "${1:-}" = "--cwd" ]; then cwd="$2"; shift 2; fi
  stdout="$(cd "$cwd" && "$PROJECT/tools/access-inspector/inspect.sh" "$@" 2>"$WORK/stderr")"
  status=$?
  stderr="$(cat "$WORK/stderr")"
  return "$status"
}

fail() {
  echo "    $*" >&2
  return 1
}

expect_status() {
  [ "$status" = "$1" ] || fail "exit $status, expected $1; stderr: ${stderr: -2000}"
}

contains() {
  case "$1" in *"$2"*) ;; *) fail "missing: $2"; return 1 ;; esac
}

line() {
  grep -qxF -- "$1" "$EXPECTED" || grep -qxF -- "$1," "$EXPECTED" || fail "no endpoint line: $1"
}

edit() {
  local file="$PROJECT/$1"
  [ -f "$file.orig" ] || cp -p "$file" "$file.orig"
  grep -qF -- "$2" "$file" || { fail "$1 lacks: $2"; return 1; }
  OLD="$2" NEW="$3" perl -0pi -e 's/\Q$ENV{OLD}\E/$ENV{NEW}/' "$file"
}

restore() {
  local orig
  for orig in $(find "$PROJECT" -name '*.orig' -not -path '*/target/*'); do mv "$orig" "${orig%.orig}" && touch "${orig%.orig}"; done
  rm -f "$OUTPUT"
}

endpoint() {
  # the canonical line of one endpoint, without its trailing comma
  grep -F "{\"method\": \"$1\", \"path\": \"$2\", \"handler\": \"$3\"," "$EXPECTED" | sed 's/,$//'
}

spring_golden() {
  run && expect_status 0 && cmp -s "$OUTPUT" "$EXPECTED" || fail "$(diff "$EXPECTED" "$OUTPUT" | head -20)"
}

spring_golden_classifications() {
  local api=com.theodo.ms.controller
  # the API chain, its permitAll matcher on GET only: HEAD falls through to anyRequest().authenticated()
  line "$(endpoint GET /api/catalog/items/{id} $api.CatalogController.item)" &&
    contains "$(endpoint GET /api/catalog/items/{id} $api.CatalogController.item)" '"authentication": {"value": "anonymous", "layer": "global", "raw": "api: PathPattern [GET /api/catalog/**] -> permitAll", "rule": "builtin:permitAll", "evidence": null}' &&
    contains "$(endpoint HEAD /api/catalog/items/{id} $api.CatalogController.item)" '"raw": "api: any request -> authenticated"' &&
    # hasRole is an authority check; the web chain's /actuator/** after /actuator/health/**
    contains "$(endpoint GET /api/admin/users $api.AdminController.users)" '"authorization": {"value": "rule", "layer": "global", "raw": "api: PathPattern [/api/admin/**] -> hasAnyAuthority('"'"'ROLE_ADMIN'"'"')", "rule": "builtin:hasAnyAuthority", "evidence": null}' &&
    contains "$(grep -F '"path": "/actuator/health", ' "$EXPECTED" | head -1)" '"value": "anonymous"' &&
    contains "$(grep -F '"method": "GET", "path": "/actuator", ' "$EXPECTED")" '"rule": "builtin:hasAnyAuthority"' &&
    # the prod profile exposes health only
    ! grep -qF '/actuator/env' "$EXPECTED" &&
    # method security per family: @PreAuthorize on the method over the class, @Secured, @RolesAllowed
    contains "$(endpoint GET /houses/v1/house $api.HousesController.getSomething)" '"authentication": {"value": "required", "layer": "method", "raw": "@PreAuthorize(\"isAuthenticated()\")", "rule": "builtin:isAuthenticated", "evidence": null}' &&
    contains "$(endpoint DELETE /houses/v1/house $api.HousesController.deleteSomething)" '"authorization": {"value": "rule", "layer": "method", "raw": "@PreAuthorize(\"hasRole('"'"'ADMIN'"'"')\")", "rule": "builtin:hasRole", "evidence": null}' &&
    contains "$(endpoint POST /trees $api.TreesController.postSomething)" '"authorization": {"value": "unknown", "layer": "class", "raw": "@PreAuthorize(\"hasRole(ADMIN)\")", "rule": null, "evidence": null}' &&
    contains "$(endpoint GET /trees $api.TreesController.getSomething)" '"raw": "@PreAuthorize(\"hasRole(USER)\")"' &&
    contains "$(endpoint PUT /another/{projectId}/upload $api.AnotherController.postSomething)" '"authorization": {"value": "rule", "layer": "method", "raw": "@Secured({\"ROLE_USER\"})", "rule": "builtin:Secured", "evidence": null}' &&
    contains "$(endpoint GET /webclient/v3/cars/{carsId}/details $api.CarsController.getSomething)" '"raw": "@RolesAllowed({\"USER\", \"ADMIN\"})"' &&
    # the mapping declared on an interface, the Recognition Rule on a bean call, the Acknowledged Unknown
    contains "$(endpoint GET /api/projects/{id} $api.ProjectsController.project)" '"authorization": {"value": "rule", "layer": "method", "raw": "@PreAuthorize(\"@permissionEvaluator.canRead(#id)\")", "rule": "recognition:can_read", "evidence": "src/main/java/com/theodo/ms/security/PermissionEvaluator.java:10"}' &&
    contains "$(endpoint ANY /legacy/export $api.LegacyController.export)" '"unknown_reason": "the export is reachable from the office network only, which the firewall enforces as well", "acknowledged": true' &&
    # a handler declaring HEAD takes it from the GET handler beside it
    [ "$(grep -c '"method": "HEAD", "path": "/houses/v1/house"' "$EXPECTED")" = 1 ] &&
    line "$(endpoint HEAD /houses/v1/house $api.HousesController.headSomething)" &&
    # HEAD beside every other GET
    [ "$(grep -o '"method": "GET", "path": "[^"]*", "handler": "[^"]*"' "$EXPECTED" | grep -vF '"/houses/v1/house"' | sed 's/"GET"/"HEAD"/')" = "$(grep -o '"method": "HEAD", "path": "[^"]*", "handler": "[^"]*"' "$EXPECTED" | grep -vF '"/houses/v1/house"')" ] ||
    fail "a GET without its HEAD"
}

spring_unknowns_output() {
  run --unknowns && expect_status 0 || return 1
  [ "$(sed 's/^{"method": "\([^"]*\)", "path": "\([^"]*\)".*/\1 \2/' <<<"$stdout")" = "$(printf '%s\n' 'ANY /legacy/export' 'GET /trees' 'HEAD /trees' 'POST /trees')" ] ||
    fail "unknowns: $stdout"
  [ ! -e "$OUTPUT" ] || fail "--unknowns wrote $OUTPUT"
}

spring_table_does_not_write() {
  cp "$EXPECTED" "$OUTPUT" && touch -t 202001010000 "$OUTPUT"
  run --table && expect_status 0 || return 1
  [ "$(wc -l <<<"$stdout")" = "$(($(grep -c '"method"' "$EXPECTED") + 1))" ] || fail "table rows: $stdout"
  [ "$(find "$OUTPUT" -newermt 2020-01-02)" = "" ] || fail "--table touched $OUTPUT"
}

spring_determinism() {
  run && expect_status 0 && cp "$OUTPUT" "$WORK/first.json" && run --cwd / && expect_status 0 && cmp -s "$OUTPUT" "$WORK/first.json" ||
    fail "a second run from / differs"
}

spring_check_clean() {
  # endpoints reversed, the last one's comma moved: same content, another order
  { sed -n '1,/"endpoints": \[/p' "$EXPECTED"
    grep '^    {"method"' "$EXPECTED" | sed 's/,$//' | tail -r 2>/dev/null || grep '^    {"method"' "$EXPECTED" | sed 's/,$//' | tac
  } | awk 'NR>1 && /^    \{"method"/ && prev ~ /^    \{"method"/ {print prev ","; prev=$0; next} NR>1 {print prev} {prev=$0} END {print prev; print "  ]"; print "}"}' >"$OUTPUT"
  cmp -s "$OUTPUT" "$EXPECTED" && { fail "the reordered inventory is the same file"; return 1; }
  cp "$OUTPUT" "$WORK/before.json"
  run --check && expect_status 0 && [ "$stdout" = "inventory up to date" ] && cmp -s "$OUTPUT" "$WORK/before.json" || fail "check: $stdout"
}

spring_check_drift() {
  cp "$EXPECTED" "$OUTPUT"
  edit src/main/java/com/theodo/ms/security/SecurityConfig.java '.requestMatchers("/api/admin/**").hasRole("ADMIN")' '.requestMatchers("/api/admin/**").authenticated()' || return 1
  run --check
  expect_status 1 &&
    contains "$stdout" '~ GET /api/admin/users (com.theodo.ms.controller.AdminController.users) authorization.value: rule -> none' &&
    contains "$stdout" 'run `tools/access-inspector/inspect.sh`' &&
    cmp -s "$OUTPUT" "$EXPECTED" || fail "check rewrote $OUTPUT"
}

spring_check_missing_inventory() {
  run --check
  expect_status 2 && contains "$stderr" 'tools/access-inspector/inventory.json not found' && contains "$stderr" 'generate it first'
}

spring_check_unreadable_inventory() {
  printf '<<<<<<< HEAD\n' >"$OUTPUT"
  run --check
  expect_status 2 && contains "$stderr" 'cannot read tools/access-inspector/inventory.json' && [ "$(cat "$OUTPUT")" = '<<<<<<< HEAD' ]
}

spring_missing_dimension() {
  edit src/test/java/accessinspector/Dimensions.java 'new Assign("access_tier", "customer", e -> true)' 'new Assign("access_tier", "customer", e -> !e.path().equals("/trees"))' || return 1
  run
  expect_status 2 && contains "$stderr" "GET /trees (com.theodo.ms.controller.TreesController.getSomething): no rule assigns dimension 'access_tier'" &&
    [ ! -e "$OUTPUT" ] || fail "wrote $OUTPUT"
}

spring_boot_failure() {
  edit src/test/java/accessinspector/Boot.java '  @MockitoBean @Reason("payment gateway reachable from production only") com.theodo.ms.payments.PaymentClient payments;' '' || return 1
  run
  expect_status 2 &&
    contains "$stderr" 'access-inspector: cannot boot com.theodo.ms.SampleApplication with profile prod: IllegalStateException: payment gateway https://payments.internal.example unreachable' &&
    [ ! -e "$OUTPUT" ] || fail "wrote $OUTPUT"
}

spring_usage_error() {
  run --bogus
  expect_status 2 && contains "$stderr" 'usage: tools/access-inspector/inspect.sh'
}

strip() {
  # a file without its project sections
  sed '/\/\/ --- project ---/,/\/\/ --- end project ---/d' "$1"
}

spring_vendored_copy_matches_the_base_script() {
  local name ok=0
  for dir in tools/access-inspector src/test/java/accessinspector; do
    [ "$(ls "$FIXTURE/$dir")" = "$(ls "$BASE_SCRIPT/$dir")" ] || { fail "$dir lists $(ls "$FIXTURE/$dir" | tr '\n' ' ')"; ok=1; }
    for name in $(ls "$BASE_SCRIPT/$dir"); do
      [ "$(strip "$FIXTURE/$dir/$name")" = "$(strip "$BASE_SCRIPT/$dir/$name")" ] || { fail "$dir/$name differs from the Base Script"; ok=1; }
    done
  done
  return $ok
}

for test in $(declare -F | awk '{print $3}' | grep '^spring_'); do
  if "$test"; then echo "ok   $test"; else echo "FAIL $test"; failures=$((failures + 1)); fi
  restore
done
[ "$failures" = 0 ] || { echo "$failures failed" >&2; exit 1; }
