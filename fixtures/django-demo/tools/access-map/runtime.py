"""The Map Runtime: canonical serialisation, the --check diff, and file:line lookup for Map Rules."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "1"
KEYS = (
    "schema_version",
    "stack",
    "base_script",
    "about",
    "roles",
    "grants",
    "scopes",
    "scoped",
    "capabilities",
    "endpoints",
    "snippets",
)
# How each list is sorted and how one of its items is named in a diff.
IDENTITY: dict[str, tuple[str, ...]] = {
    "roles": ("id",),
    "scopes": ("id",),
    "scoped": ("capability", "role", "scope"),
    "capabilities": ("id",),
    "endpoints": ("path", "method", "handler"),
}


class MapRuleError(Exception):
    """A Map Rule cites a line that is not in the file: exit 2."""


def line_of(root: Path, path: str, text: str) -> str:
    """`path:line` of the first line of `path` containing `text`, for a Map Rule's `at`."""
    lines = (root / path).read_text(encoding="utf-8").splitlines()
    for number, line in enumerate(lines, 1):
        if text in line:
            return f"{path}:{number}"
    raise MapRuleError(f"{path}: no line contains {text!r}")


def _identity(name: str, item: dict[str, Any]) -> tuple[str, ...]:
    return tuple(str(item[k]) for k in IDENTITY[name])


def canonical(runtime: dict[str, Any]) -> dict[str, Any]:
    """Keys in schema order, lists sorted, grants by role: equal content gives equal bytes."""
    out = {key: runtime[key] for key in KEYS}
    for name in IDENTITY:
        out[name] = sorted(runtime[name], key=lambda item: _identity(name, item))
    out["grants"] = {
        permission: sorted(holders, key=lambda h: (h["role"], h["at"]))
        for permission, holders in sorted(runtime["grants"].items())
    }
    out["snippets"] = dict(sorted(runtime["snippets"].items()))
    return out


def _compact(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(", ", ": "))


def to_canonical_json(runtime: dict[str, Any]) -> str:
    """One root key per line; each list item, grant and snippet on its own line."""
    data = canonical(runtime)
    lines = ["{"]
    for i, key in enumerate(KEYS):
        comma = "," if i < len(KEYS) - 1 else ""
        value = data[key]
        if isinstance(value, list) and value:
            items = [f"    {_compact(item)}" for item in value]
        elif key in ("grants", "snippets") and value:
            items = [f"    {_compact(k)}: {_compact(v)}" for k, v in value.items()]
        else:
            lines.append(f"  {_compact(key)}: {_compact(value)}{comma}")
            continue
        brackets = "[]" if isinstance(value, list) else "{}"
        lines.append(f"  {_compact(key)}: {brackets[0]}")
        lines.append(",\n".join(items))
        lines.append(f"  {brackets[1]}{comma}")
    lines.append("}")
    return "\n".join(lines) + "\n"


def check(committed: dict[str, Any], current: dict[str, Any]) -> list[str]:
    """Diff lines from the committed runtime to the regenerated one; empty when they match."""
    old = canonical(committed)
    new = canonical(json.loads(to_canonical_json(current)))
    lines: list[str] = []
    for key in KEYS:
        if old[key] == new[key]:
            continue
        if key in IDENTITY:
            before = {_identity(key, item): item for item in old[key]}
            after = {_identity(key, item): item for item in new[key]}
        elif key in ("grants", "snippets"):
            before = {(k,): v for k, v in old[key].items()}
            after = {(k,): v for k, v in new[key].items()}
        else:
            lines.append(f"~ {key}: {_compact(old[key])} -> {_compact(new[key])}")
            continue
        for ident in sorted(before.keys() | after.keys()):
            name = f"{key} {' '.join(ident)}"
            if ident not in after:
                lines.append(f"- {name}")
            elif ident not in before:
                lines.append(f"+ {name}: {_compact(after[ident])}")
            elif before[ident] != after[ident]:
                lines.append(
                    f"~ {name}: {_compact(before[ident])} -> {_compact(after[ident])}"
                )
    return lines
