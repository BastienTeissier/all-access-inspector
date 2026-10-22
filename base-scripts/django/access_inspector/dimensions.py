"""Project Dimensions: the project's own labels, assigned to every endpoint by ordered rules."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from access_inspector.inventory import Endpoint


@dataclass(frozen=True)
class Assign:
    dimension: str
    value: str
    when: Callable[[Endpoint], bool]


class MissingDimension(Exception):
    pass


# --- project ---
# Declared values, in order, e.g. {"access_tier": ["public", "customer", "staff"]}.
DIMENSIONS: dict[str, list[str]] = {}

# Most specific first; the first matching rule of a dimension wins, e.g.:
# Assign("access_tier", "staff", lambda e: e.path.startswith("/admin/")),
RULES: list[Assign] = []
# --- end project ---


def assign(
    endpoint: Endpoint,
    dimensions: dict[str, list[str]] | None = None,
    rules: list[Assign] | None = None,
) -> dict[str, str]:
    """One value per declared dimension; an endpoint no rule covers is a failure, never a null."""
    dimensions = DIMENSIONS if dimensions is None else dimensions
    rules = RULES if rules is None else rules
    values = {}
    for dimension in dimensions:
        value = next(
            (r.value for r in rules if r.dimension == dimension and r.when(endpoint)),
            None,
        )
        if value is None:
            raise MissingDimension(
                f"{endpoint.label()}: no rule assigns dimension {dimension!r}"
            )
        values[dimension] = value
    return values
