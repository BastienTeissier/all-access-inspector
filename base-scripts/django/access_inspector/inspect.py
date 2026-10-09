"""Adapted Script entrypoint: python tools/access-inspector/inspect.py [--check | --table | --unknowns]."""

import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
# This file shadows the stdlib `inspect` and its siblings may collide with project modules:
# drop the script directory from the import path and expose the siblings as one private package.
if sys.path and os.path.abspath(sys.path[0] or os.curdir) == HERE:
    sys.path.pop(0)
if "access_inspector" not in sys.modules:
    package = types.ModuleType("access_inspector")
    package.__path__ = [HERE]
    sys.modules["access_inspector"] = package

import argparse  # noqa: E402
import dataclasses  # noqa: E402
import json  # noqa: E402
import traceback  # noqa: E402
from pathlib import Path  # noqa: E402

from access_inspector import boot, dimensions, inventory, rules, table  # noqa: E402

OUTPUT = Path(HERE) / "inventory.json"
HERE_REL = Path(HERE).resolve().relative_to(boot.ROOT).as_posix()
VERSION = Path(HERE) / "VERSION"


def build(environment: inventory.BootEnvironment) -> inventory.Inventory:
    from access_inspector import classify, discovery

    found: dict[tuple[str, str, str], list[list[rules.Finding]]] = {}
    for raw in discovery.endpoints():
        for c in classify.classify(raw, boot.ROOT):
            found.setdefault((raw.path, c.method, c.handler), []).append(c.findings)
    endpoints = []
    for (path, method, handler), variants in found.items():
        findings = variants[0]
        if any(v != findings for v in variants):
            # Django serves whichever pattern matches the request first: not readable from the path alone.
            unreadable = f"{len(variants)} URL patterns resolve to this path with different access checks"
            findings = [rules.Finding(handler, None, None, unreadable)]
        authn, authz, reason = rules.resolve(findings, method, path)
        endpoint = inventory.Endpoint(method, path, handler, authn, authz, {}, reason)
        endpoints.append(
            dataclasses.replace(endpoint, dimensions=dimensions.assign(endpoint))
        )
    return inventory.Inventory(
        schema_version=inventory.SCHEMA_VERSION,
        stack="django",
        discovery_mode="runtime",
        coverage="complete",
        coverage_note=None,
        base_script=inventory.BaseScript(
            "django", VERSION.read_text(encoding="utf-8").strip()
        ),
        boot_environment=environment,
        project_dimensions=dimensions.DIMENSIONS,
        endpoints=sorted(endpoints, key=inventory.sort_key),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Write the Endpoint Inventory of this Django project."
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--check",
        action="store_true",
        help="exit 1 with a per-endpoint diff when inventory.json is out of date; write nothing",
    )
    mode.add_argument(
        "--table", action="store_true", help="print a table; write nothing"
    )
    mode.add_argument(
        "--unknowns",
        action="store_true",
        help="print unknown endpoints as JSON lines; write nothing",
    )
    args = parser.parse_args(argv)
    committed = f"{HERE_REL}/{OUTPUT.name}"
    if args.check:  # an unusable Committed Inventory fails before paying for the boot
        if not OUTPUT.is_file():
            print(
                f"access-inspector: {committed} not found;"
                f" generate it first with `python {HERE_REL}/inspect.py` and commit it",
                file=sys.stderr,
            )
            return 2
        try:
            before = inventory.from_dict(json.loads(OUTPUT.read_text(encoding="utf-8")))
        except (ValueError, KeyError, TypeError) as exc:
            print(
                f"access-inspector: cannot read {committed}: {exc!r}", file=sys.stderr
            )
            return 2
    try:
        rules.check_rules(rules.RECOGNITION, boot.ROOT)
        result = build(boot.boot())
        inventory.validate(result)
    except boot.BootError as exc:
        traceback.print_exception(exc.__cause__ or exc, file=sys.stderr)
        print(f"access-inspector: {exc}", file=sys.stderr)
        return 2
    except (
        rules.RuleError,
        dimensions.MissingDimension,
        inventory.ValidationError,
    ) as exc:
        print(f"access-inspector: {exc}", file=sys.stderr)
        return 2
    if args.check:
        diff = inventory.check(before, result)
        if not diff:
            print("inventory up to date")
            return 0
        print("\n".join(diff))
        print(
            f"\n{committed} differs from the endpoints this code serves."
            f"\nIf the change is intended, run `python {HERE_REL}/inspect.py` and commit {committed}."
        )
        return 1
    if args.table:
        print(table.render(result))
    elif args.unknowns:
        for endpoint in result.endpoints:
            if endpoint.is_unknown:
                print(json.dumps(dataclasses.asdict(endpoint), ensure_ascii=False))
    else:
        partial = OUTPUT.with_suffix(".json.tmp")
        partial.write_text(
            inventory.to_canonical_json(result), encoding="utf-8", newline="\n"
        )
        os.replace(partial, OUTPUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
