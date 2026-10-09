"""Adapted Script entrypoint: python tools/access-inspector/inspect.py [--table | --unknowns]."""

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
VERSION = Path(HERE) / "VERSION"


def build(environment: inventory.BootEnvironment) -> inventory.Inventory:
    from access_inspector import classify, discovery

    endpoints: dict[tuple[str, str, str], inventory.Endpoint] = {}
    for raw in discovery.endpoints():
        for found in classify.classify(raw, boot.ROOT):
            authn, authz, reason = rules.resolve(found.findings, found.method, raw.path)
            endpoint = inventory.Endpoint(
                found.method, raw.path, found.handler, authn, authz, {}, reason
            )
            endpoint = dataclasses.replace(
                endpoint, dimensions=dimensions.assign(endpoint)
            )
            endpoints.setdefault(
                inventory.sort_key(endpoint), endpoint
            )  # Django serves the first match
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
        endpoints=sorted(endpoints.values(), key=inventory.sort_key),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Write the Endpoint Inventory of this Django project."
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--table", action="store_true", help="print a table; write nothing"
    )
    mode.add_argument(
        "--unknowns",
        action="store_true",
        help="print unknown endpoints as JSON lines; write nothing",
    )
    args = parser.parse_args(argv)
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
