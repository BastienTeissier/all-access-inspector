"""Map Introspect entrypoint: python tools/access-map/introspect.py [--check]."""

import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
# Its siblings may collide with project modules: drop the script directory from the import path
# and expose them, and the Adapted Script beside them, as private packages.
if sys.path and os.path.abspath(sys.path[0] or os.curdir) == HERE:
    sys.path.pop(0)
for name, path in (
    ("access_map", HERE),
    ("access_inspector", os.path.join(os.path.dirname(HERE), "access-inspector")),
):
    if name not in sys.modules:
        package = types.ModuleType(name)
        package.__path__ = [path]
        sys.modules[name] = package

import argparse  # noqa: E402
import json  # noqa: E402
import traceback  # noqa: E402
from pathlib import Path  # noqa: E402
from typing import Any  # noqa: E402

from access_inspector import boot  # noqa: E402
from access_map import project, runtime  # noqa: E402

OUTPUT = Path(HERE) / "runtime.json"
VOCABULARY = Path(HERE) / "vocabulary.json"
HERE_REL = Path(HERE).resolve().relative_to(boot.ROOT).as_posix()
INVENTORY = Path(HERE).parent / "access-inspector" / "inventory.json"
VERSION = Path(HERE).parent / "access-inspector" / "VERSION"


def facts(rule: str, keys: tuple[str, ...]) -> list[dict[str, Any]]:
    """The facts one Map Rule returns, each holding `keys`."""
    found: list[dict[str, Any]] = getattr(project, rule)()
    for fact in found:
        missing = [k for k in keys if k not in fact]
        if missing:
            raise runtime.MapRuleError(
                f"{rule}() returned {fact!r} without {', '.join(missing)}"
            )
    return found


def roles() -> list[dict[str, Any]]:
    from access_map import admin

    found = {"superuser": {**admin.superuser_role(), "includes": [], "staff": None}}
    for r in facts("roles", ("id", "kind", "at")):
        found[r["id"]] = {
            "id": r["id"],
            "kind": r["kind"],
            "at": r["at"],
            "basis": "rule",
            "includes": [],
            "staff": None,
        }
    for i in facts("includes", ("role", "includes", "at")):
        if i["role"] not in found:
            raise runtime.MapRuleError(f"includes(): no role {i['role']!r}")
        found[i["role"]]["includes"].append({"role": i["includes"], "at": i["at"]})
    for s in facts("staff", ("role", "at")):
        if s["role"] not in found:
            raise runtime.MapRuleError(f"staff(): no role {s['role']!r}")
        found[s["role"]]["staff"] = {"at": s["at"]}
    for role in found.values():
        role["includes"].sort(key=lambda i: (i["role"], i["at"]))
    return list(found.values())


def grants() -> dict[str, list[dict[str, str]]]:
    found: dict[str, list[dict[str, str]]] = {}
    for g in facts("grants", ("permission", "role", "at")):
        found.setdefault(g["permission"], []).append({"role": g["role"], "at": g["at"]})
    return found


def build(inventory: dict[str, Any], admin_actions: dict[str, Any]) -> dict[str, Any]:
    from access_map import admin

    introspect = admin.Introspect(admin_actions)
    rows = [e for e in inventory["endpoints"] if e["method"] != "HEAD"]
    endpoints = [e for e in map(introspect.endpoint, rows) if e is not None]
    keys = ("id", "area", "term", "verb", "endpoints", "check", "at")
    return {
        "schema_version": runtime.SCHEMA_VERSION,
        "stack": "django",
        "base_script": {
            "stack": "django",
            "version": VERSION.read_text(encoding="utf-8").strip(),
        },
        "about": admin.ABOUT,
        "roles": roles(),
        "grants": grants(),
        "scopes": introspect.scope_candidates()
        + [
            {**{k: s[k] for k in ("id", "label", "at")}, "basis": "inferred"}
            for s in facts("scopes", ("id", "label", "at"))
        ],
        "scoped": [
            {
                **{k: s[k] for k in ("capability", "role", "scope", "at")},
                "basis": "rule",
            }
            for s in facts("scoped", ("capability", "role", "scope", "at"))
        ],
        "capabilities": introspect.capabilities(rows)
        + [
            {**{k: c[k] for k in keys}, "basis": "rule"}
            for c in facts("capabilities", keys)
        ],
        "endpoints": endpoints,
        "snippets": introspect.snippets,
    }


def read(path: Path, what: str) -> dict[str, Any]:
    try:
        data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise runtime.MapRuleError(
            f"cannot read {what} {path.relative_to(boot.ROOT).as_posix()}: {exc}"
        ) from exc
    return data


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Write the Map Runtime of this Django project."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit 1 with a diff when runtime.json is out of date; write nothing",
    )
    args = parser.parse_args(argv)
    committed = f"{HERE_REL}/{OUTPUT.name}"
    try:
        before = read(OUTPUT, "the committed runtime") if args.check else None
        inventory = read(INVENTORY, "the Committed Inventory")
        vocabulary = read(VOCABULARY, "the vocabulary") if VOCABULARY.is_file() else {}
        boot.boot()
        result = build(inventory, vocabulary.get("stack", {}).get("admin_actions", {}))
    except boot.BootError as exc:
        traceback.print_exception(exc.__cause__ or exc, file=sys.stderr)
        print(f"access-map: {exc}", file=sys.stderr)
        return 2
    except runtime.MapRuleError as exc:
        print(f"access-map: {exc}", file=sys.stderr)
        return 2
    if before is not None:
        diff = runtime.check(before, result)
        if not diff:
            print("runtime up to date")
            return 0
        print("\n".join(diff))
        print(
            f"\n{committed} differs from what this code declares."
            f"\nIf the change is intended, run `python {HERE_REL}/introspect.py` and commit {committed}."
        )
        return 1
    partial = OUTPUT.with_suffix(".json.tmp")
    partial.write_text(
        runtime.to_canonical_json(result), encoding="utf-8", newline="\n"
    )
    os.replace(partial, OUTPUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
