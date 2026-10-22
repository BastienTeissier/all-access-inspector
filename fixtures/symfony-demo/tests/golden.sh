#!/usr/bin/env bash
# Golden-file tests: run the vendored Adapted Script inside a copy of this fixture. Needs PHP 8.4 and the fixture's
# vendor/ (composer install); `make test-symfony` runs both in a container.
set -uo pipefail

FIXTURE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_SCRIPT="$FIXTURE/../../skills/all-access-inspector/base-scripts/symfony"
EXPECTED="$FIXTURE/expected/inventory.json"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PROJECT="$WORK/symfony-demo"
OUTPUT="$PROJECT/tools/access-inspector/inventory.json"
# One copy for every test; each test restores what it edits.
tar -C "$FIXTURE" --exclude=./var --exclude=./tests --exclude=./expected -cf - . | (mkdir -p "$PROJECT" && tar -C "$PROJECT" -xf -)

failures=0
status=0 stdout="" stderr=""

run() {
  local cwd="$PROJECT"
  if [ "${1:-}" = "--cwd" ]; then cwd="$2"; shift 2; fi
  stdout="$(cd "$cwd" && php "$PROJECT/tools/access-inspector/inspect.php" "$@" 2>"$WORK/stderr")"
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

edit() {
  local file="$PROJECT/$1"
  [ -f "$file.orig" ] || cp -p "$file" "$file.orig"
  grep -qF -- "$2" "$file" || { fail "$1 lacks: $2"; return 1; }
  OLD="$2" NEW="$3" php -r '$f = $argv[1]; file_put_contents($f, str_replace(getenv("OLD"), getenv("NEW"), file_get_contents($f)));' "$file"
}

restore() {
  local orig
  for orig in $(find "$PROJECT" -name '*.orig' -not -path '*/vendor/*'); do mv "$orig" "${orig%.orig}"; done
  rm -f "$OUTPUT"
}

endpoint() {
  # the canonical line of one endpoint, without its trailing comma
  grep -F "{\"method\": \"$1\", \"path\": \"$2\", \"handler\": \"$3\"," "$EXPECTED" | sed 's/,$//'
}

symfony_golden() {
  run && expect_status 0 && cmp -s "$OUTPUT" "$EXPECTED" || fail "$(diff "$EXPECTED" "$OUTPUT" | head -20)"
}

symfony_golden_classifications() {
  local c=src/Controller
  # access_control: the first entry matching the path, a firewall with security: false, no entry at all
  contains "$(endpoint GET /admin $c/AdminController.php:14)" '"authorization": {"value": "rule", "layer": "global", "raw": "main: ^/admin -> ROLE_ADMIN", "rule": "builtin:role", "evidence": null}' &&
    contains "$(endpoint GET /status $c/StatusController.php:11)" '"authentication": {"value": "anonymous", "layer": "global", "raw": "status: security: false", "rule": "builtin:security_false", "evidence": null}' &&
    contains "$(endpoint GET / $c/HomeController.php:11)" '"raw": "main: no access_control entry", "rule": "builtin:no_access_control"' &&
    # #[IsGranted] on the method, for its methods only; denyAccessUnlessGranted() in the body
    contains "$(endpoint POST /admin/purge $c/AdminController.php:21)" '"authorization": {"value": "rule", "layer": "global", "raw": "main: ^/admin -> ROLE_ADMIN"' &&
    contains "$(endpoint POST /account/profile $c/AccountController.php:13)" '"authorization": {"value": "rule", "layer": "method", "raw": "#[IsGranted('"'"'ROLE_EDITOR'"'"', methods: ['"'"'POST'"'"'])]", "rule": "builtin:role", "evidence": null}' &&
    contains "$(endpoint GET /account/profile $c/AccountController.php:13)" '"authorization": {"value": "none", "layer": "global", "raw": "main: ^/account -> IS_AUTHENTICATED_FULLY"' &&
    contains "$(endpoint POST /posts/{id} $c/PostController.php:12)" '"raw": "denyAccessUnlessGranted('"'"'EDIT'"'"', $post)", "rule": null, "evidence": null}, "dimensions": {"access_tier": "user"}, "unknown_reason": "voter check in handler body", "acknowledged": false}' &&
    # the Recognition Rule on a voter, the Acknowledged Unknown on a conditional entry
    contains "$(endpoint GET /projects/{project} $c/ProjectController.php:13)" '"rule": "recognition:project_view", "evidence": "src/Security/ProjectVoter.php:18"' &&
    contains "$(endpoint GET /metrics $c/MetricsController.php:11)" '"raw": "main: ^/metrics ips=10.0.0.0/8 -> PUBLIC_ACCESS", "rule": null, "evidence": null}, "dimensions": {"access_tier": "public"}, "unknown_reason": "the office network reads /metrics without login; the next entry denies every other request", "acknowledged": true}' &&
    # API Platform: the resource's security at class layer, an operation's own at method layer, each at its line
    contains "$(endpoint GET /api/books/{id}.{_format} src/ApiResource/Book.php:14)" '"authorization": {"value": "rule", "layer": "class", "raw": "security: is_granted('"'"'ROLE_USER'"'"')", "rule": "builtin:role", "evidence": null}' &&
    contains "$(endpoint POST /api/books.{_format} src/ApiResource/Book.php:16)" '"layer": "method", "raw": "security: is_granted('"'"'ROLE_ADMIN'"'"')"' &&
    # a route without methods is ANY; HEAD beside every GET
    [ -n "$(endpoint ANY /legacy $c/LegacyController.php:11)" ] &&
    [ "$(grep -o '"method": "GET", "path": "[^"]*", "handler": "[^"]*"' "$EXPECTED" | sed 's/"GET"/"HEAD"/')" = "$(grep -o '"method": "HEAD", "path": "[^"]*", "handler": "[^"]*"' "$EXPECTED")" ] ||
    fail "a classification differs"
}

symfony_unknowns_output() {
  run --unknowns && expect_status 0 || return 1
  [ "$(sed 's/^{"method": "\([^"]*\)", "path": "\([^"]*\)".*/\1 \2/' <<<"$stdout")" = "$(printf '%s\n' 'DELETE /api/books/{id}.{_format}' 'GET /metrics' 'HEAD /metrics' 'POST /posts/{id}')" ] ||
    fail "unknowns: $stdout"
  [ ! -e "$OUTPUT" ] || fail "--unknowns wrote $OUTPUT"
}

symfony_table_does_not_write() {
  echo sentinel >"$OUTPUT"
  run --table && expect_status 0 || return 1
  [ "$(wc -l <<<"$stdout")" = "$(($(grep -c '"method"' "$EXPECTED") + 1))" ] || fail "table rows: $stdout"
  [ "$(cat "$OUTPUT")" = sentinel ] || fail "--table wrote $OUTPUT"
}

symfony_determinism() {
  run && expect_status 0 && cp "$OUTPUT" "$WORK/first.json" && run --cwd / && expect_status 0 && cmp -s "$OUTPUT" "$WORK/first.json" ||
    fail "a second run from / differs"
}

symfony_check_clean() {
  # endpoints reversed, the last one's comma moved: same content, another order
  { sed -n '1,/"endpoints": \[/p' "$EXPECTED"
    grep '^    {"method"' "$EXPECTED" | sed 's/,$//' | tac
  } | awk 'NR>1 && /^    \{"method"/ && prev ~ /^    \{"method"/ {print prev ","; prev=$0; next} NR>1 {print prev} {prev=$0} END {print prev; print "  ]"; print "}"}' >"$OUTPUT"
  cmp -s "$OUTPUT" "$EXPECTED" && { fail "the reordered inventory is the same file"; return 1; }
  cp "$OUTPUT" "$WORK/before.json"
  run --check && expect_status 0 && [ "$stdout" = "inventory up to date" ] && cmp -s "$OUTPUT" "$WORK/before.json" || fail "check: $stdout"
}

symfony_check_drift() {
  cp "$EXPECTED" "$OUTPUT"
  edit config/packages/security.yaml '{ path: ^/admin, roles: ROLE_ADMIN }' '{ path: ^/admin, roles: IS_AUTHENTICATED }' || return 1
  run --check
  expect_status 1 &&
    contains "$stdout" '~ GET /admin (src/Controller/AdminController.php:14) authorization.value: rule -> none' &&
    contains "$stdout" 'run `php tools/access-inspector/inspect.php`' &&
    cmp -s "$OUTPUT" "$EXPECTED" || fail "check rewrote $OUTPUT"
}

symfony_check_missing_inventory() {
  run --check
  expect_status 2 && contains "$stderr" 'tools/access-inspector/inventory.json not found' && contains "$stderr" 'generate it first'
}

symfony_check_unreadable_inventory() {
  printf '<<<<<<< HEAD\n' >"$OUTPUT"
  run --check
  expect_status 2 && contains "$stderr" 'cannot read tools/access-inspector/inventory.json' && [ "$(cat "$OUTPUT")" = '<<<<<<< HEAD' ]
}

symfony_missing_dimension() {
  edit tools/access-inspector/src/Dimensions.php "new Assign('access_tier', 'public', fn (Endpoint \$e) => true)" "new Assign('access_tier', 'public', fn (Endpoint \$e) => \$e->path !== '/legacy')" || return 1
  run
  expect_status 2 && contains "$stderr" "ANY /legacy (src/Controller/LegacyController.php:11): no rule assigns dimension 'access_tier'" &&
    [ ! -e "$OUTPUT" ] || fail "wrote $OUTPUT"
}

symfony_boot_failure() {
  edit tools/access-inspector/src/Boot.php "new Env('TRUSTED_IPS'," "// new Env('TRUSTED_IPS'," || return 1
  run
  expect_status 2 &&
    contains "$stderr" 'access-inspector: cannot boot App\Kernel with env prod: EnvNotFoundException: Environment variable not found: "TRUSTED_IPS".' &&
    [ ! -e "$OUTPUT" ] || fail "wrote $OUTPUT"
}

symfony_environ_refuses_the_environment() {
  edit tools/access-inspector/src/Boot.php "new Env('TRUSTED_IPS'," "new Env('APP_ENV', 'dev', 'x'), new Env('TRUSTED_IPS'," || return 1
  run
  expect_status 2 && [ "$stderr" = 'access-inspector: set the environment with Boot::ENV, not APP_ENV' ]
}

symfony_api_platform_metadata_absent() {
  # the factory renamed: API Platform operations read unknown with the reason, the run still writes
  edit tools/access-inspector/src/ApiPlatform.php "FACTORY = 'api_platform.metadata.resource.metadata_collection_factory'" "FACTORY = 'api_platform.renamed'" || return 1
  run && expect_status 0 || return 1
  contains "$(grep -F '"method": "GET", "path": "/api/books/{id}.{_format}"' "$OUTPUT")" '"unknown_reason": "API Platform metadata unavailable: no service api_platform.renamed", "acknowledged": false}' &&
    contains "$(grep -F '"method": "GET", "path": "/admin"' "$OUTPUT")" '"rule": "builtin:role"'
}

symfony_usage_error() {
  run --bogus
  expect_status 2 && contains "$stderr" 'usage: php tools/access-inspector/inspect.php'
}

strip() {
  # a file without its project sections
  sed '/\/\/ --- project ---/,/\/\/ --- end project ---/d' "$1"
}

symfony_vendored_copy_matches_the_base_script() {
  local name ok=0
  for dir in tools/access-inspector tools/access-inspector/src; do
    [ "$(ls "$FIXTURE/$dir")" = "$(ls "$BASE_SCRIPT/$dir")" ] || { fail "$dir lists $(ls "$FIXTURE/$dir" | tr '\n' ' ')"; ok=1; }
    for name in $(ls "$BASE_SCRIPT/$dir"); do
      [ -d "$BASE_SCRIPT/$dir/$name" ] && continue
      [ "$(strip "$FIXTURE/$dir/$name")" = "$(strip "$BASE_SCRIPT/$dir/$name")" ] || { fail "$dir/$name differs from the Base Script"; ok=1; }
    done
  done
  return $ok
}

for test in $(declare -F | awk '{print $3}' | grep '^symfony_'); do
  if "$test"; then echo "ok   $test"; else echo "FAIL $test"; failures=$((failures + 1)); fi
  restore
done
[ "$failures" = 0 ] || { echo "$failures failed" >&2; exit 1; }
