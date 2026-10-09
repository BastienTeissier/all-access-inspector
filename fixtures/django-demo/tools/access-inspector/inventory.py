"""Endpoint Inventory model, canonical serialisation and the checks JSON Schema cannot express."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Any

SCHEMA_VERSION = "1"
METHODS = ("ANY", "DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT")
AUTHENTICATION = ("anonymous", "optional", "required", "unknown")
AUTHORIZATION = ("none", "rule", "unknown")
LAYERS = ("global", "class", "method", "framework-default", None)


class ValidationError(Exception):
    pass


@dataclass(frozen=True)
class Axis:
    value: str
    layer: str | None
    raw: str | None
    rule: str | None


@dataclass(frozen=True)
class Endpoint:
    method: str
    path: str
    handler: str
    authentication: Axis
    authorization: Axis
    dimensions: dict[str, str] = field(default_factory=dict)
    unknown_reason: str | None = None

    @property
    def is_unknown(self) -> bool:
        return "unknown" in (self.authentication.value, self.authorization.value)

    def label(self) -> str:
        return f"{self.method} {self.path} ({self.handler})"


@dataclass(frozen=True)
class Stub:
    target: str
    reason: str


@dataclass(frozen=True)
class Pin:
    setting: str
    value: Any
    reason: str


@dataclass(frozen=True)
class BootEnvironment:
    entry: str
    stubs: list[Stub]
    pinned: list[Pin]


@dataclass(frozen=True)
class BaseScript:
    stack: str
    version: str


@dataclass(frozen=True)
class Inventory:
    schema_version: str
    stack: str
    discovery_mode: str
    coverage: str
    coverage_note: str | None
    base_script: BaseScript
    boot_environment: BootEnvironment
    project_dimensions: dict[str, list[str]]
    endpoints: list[Endpoint]


def sort_key(endpoint: Endpoint) -> tuple[str, str, str]:
    return (endpoint.path, endpoint.method, endpoint.handler)


def to_canonical_json(inventory: Inventory) -> str:
    """Serialise per plan §2; the reference bytes are schema/samples/canonical.json."""
    data = asdict(inventory)
    endpoints = [asdict(e) for e in sorted(inventory.endpoints, key=sort_key)]
    lines = ["{"]
    lines += [
        f"  {_compact(key)}: {_compact(value)},"
        for key, value in data.items()
        if key != "endpoints"
    ]
    if endpoints:
        lines.append('  "endpoints": [')
        lines.append(",\n".join(f"    {_compact(e)}" for e in endpoints))
        lines.append("  ]")
    else:
        lines.append('  "endpoints": []')
    lines.append("}")
    return "\n".join(lines) + "\n"


def from_dict(data: dict[str, Any]) -> Inventory:
    boot = data["boot_environment"]
    return Inventory(
        schema_version=data["schema_version"],
        stack=data["stack"],
        discovery_mode=data["discovery_mode"],
        coverage=data["coverage"],
        coverage_note=data["coverage_note"],
        base_script=BaseScript(**data["base_script"]),
        boot_environment=BootEnvironment(
            entry=boot["entry"],
            stubs=[Stub(**s) for s in boot["stubs"]],
            pinned=[Pin(**p) for p in boot["pinned"]],
        ),
        project_dimensions=data["project_dimensions"],
        endpoints=[
            Endpoint(
                method=e["method"],
                path=e["path"],
                handler=e["handler"],
                authentication=Axis(**e["authentication"]),
                authorization=Axis(**e["authorization"]),
                dimensions=e["dimensions"],
                unknown_reason=e["unknown_reason"],
            )
            for e in data["endpoints"]
        ],
    )


def check(committed: Inventory, current: Inventory) -> list[str]:
    """Diff lines from the Committed Inventory to the regenerated one; empty when they match.

    Structural, so the committed file's ordering and whitespace never count as a difference.
    """
    current = from_dict(json.loads(to_canonical_json(current)))  # compare as written
    old, new = asdict(committed), asdict(current)
    lines = [
        f"~ {key}: {_compact(old[key])} -> {_compact(new[key])}"
        for key in new
        if key != "endpoints" and old[key] != new[key]
    ]
    before = {sort_key(e): e for e in committed.endpoints}
    after = {sort_key(e): e for e in current.endpoints}
    for key in sorted(before.keys() | after.keys()):
        if key not in after:
            lines.append(f"- {before[key].label()}")
        elif key not in before:
            e = after[key]
            unknown = " [unknown]" if e.is_unknown else ""
            lines.append(
                f"+ {e.label()} authentication={e.authentication.value}"
                f" authorization={e.authorization.value}{unknown}"
            )
        else:
            was, now = _flatten(asdict(before[key])), _flatten(asdict(after[key]))
            lines += [
                f"~ {after[key].label()} {name}: {_text(was.get(name))} -> {_text(now.get(name))}"
                for name in dict.fromkeys([*was, *now])
                if was.get(name) != now.get(name)
            ]
    return lines


def _flatten(data: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    flat: dict[str, Any] = {}
    for key, value in data.items():
        if isinstance(value, dict):
            flat.update(_flatten(value, f"{prefix}{key}."))
        else:
            flat[prefix + key] = value
    return flat


def _text(value: Any) -> str:
    return value if isinstance(value, str) else _compact(value)


def validate(inventory: Inventory) -> None:
    """Raise ValidationError naming the first offending endpoint; never write an invalid inventory."""
    if inventory.discovery_mode == "static" and inventory.coverage != "best-effort":
        raise ValidationError("static discovery must claim coverage best-effort")
    if inventory.coverage == "best-effort" and not inventory.coverage_note:
        raise ValidationError("coverage best-effort requires a coverage_note")
    for name, values in inventory.project_dimensions.items():
        if not values or len(set(values)) != len(values) or "" in values:
            raise ValidationError(
                f"dimension {name} needs a non-empty list of distinct non-empty values"
            )
    seen: set[tuple[str, str, str]] = set()
    for endpoint in inventory.endpoints:
        _validate_endpoint(endpoint, inventory.project_dimensions)
        identity = sort_key(endpoint)
        if identity in seen:
            raise ValidationError(f"duplicate endpoint {endpoint.label()}")
        seen.add(identity)


def _validate_endpoint(
    endpoint: Endpoint, project_dimensions: dict[str, list[str]]
) -> None:
    def fail(message: str) -> None:
        raise ValidationError(f"{endpoint.label()}: {message}")

    if endpoint.method not in METHODS:
        fail(f"method {endpoint.method!r} outside {METHODS}")
    if not endpoint.path.startswith("/"):
        fail("path must start with /")
    for name, axis, values in (
        ("authentication", endpoint.authentication, AUTHENTICATION),
        ("authorization", endpoint.authorization, AUTHORIZATION),
    ):
        if axis.value not in values:
            fail(f"{name}.value {axis.value!r} outside the Core Classification")
        if axis.layer not in LAYERS:
            fail(f"{name}.layer {axis.layer!r} outside {LAYERS}")
        if (axis.value == "unknown") != (axis.rule is None):
            fail(f"{name}: an unknown value has no rule and any other value names one")
    if endpoint.unknown_reason is not None and (
        not endpoint.unknown_reason or not endpoint.is_unknown
    ):
        fail("unknown_reason must be non-empty and sit next to an unknown value")
    if set(endpoint.dimensions) != set(project_dimensions):
        fail(
            f"dimensions {sorted(endpoint.dimensions)} must equal project dimensions {sorted(project_dimensions)}"
        )
    for dimension, value in endpoint.dimensions.items():
        if value not in project_dimensions[dimension]:
            fail(f"dimension {dimension}={value!r} is not declared")


def _compact(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)
