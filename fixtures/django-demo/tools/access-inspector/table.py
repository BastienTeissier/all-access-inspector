"""Fixed-width terminal table rendered from an inventory; never written to disk."""

from __future__ import annotations

from access_inspector.inventory import Axis, Inventory, sort_key

HEADER = (
    "",
    "METHOD",
    "PATH",
    "AUTHENTICATION",
    "AUTHORIZATION",
    "HANDLER",
    "DIMENSIONS",
)


def render(inventory: Inventory) -> str:
    rows = [HEADER] + [
        (
            "?" if e.is_unknown else "",
            e.method,
            e.path,
            _axis(e.authentication),
            _axis(e.authorization),
            e.handler,
            " ".join(f"{k}={v}" for k, v in e.dimensions.items()),
        )
        for e in sorted(inventory.endpoints, key=sort_key)
    ]
    widths = [max(len(row[i]) for row in rows) for i in range(len(HEADER))]
    return "\n".join(
        "  ".join(c.ljust(w) for c, w in zip(row, widths)).rstrip() for row in rows
    )


def _axis(axis: Axis) -> str:
    return f"{axis.value}@{axis.layer}" if axis.layer else axis.value
