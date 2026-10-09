import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator

REPO = Path(__file__).resolve().parents[3]
SCHEMA = json.loads(
    (REPO / "schema" / "inventory.schema.json").read_text(encoding="utf-8")
)
VALIDATOR = Draft202012Validator(SCHEMA)
CANONICAL = REPO / "schema" / "samples" / "canonical.json"
SAMPLES = sorted(
    [
        *(REPO / "schema" / "samples").glob("*.json"),
        *(REPO / "fixtures").glob("*/expected/inventory.json"),
    ]
)

Inventory = dict[str, Any]


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def set_at(keys: list[Any], value: Any) -> Callable[[Inventory], None]:
    def mutate(inventory: Inventory) -> None:
        target = inventory
        for key in keys[:-1]:
            target = target[key]
        target[keys[-1]] = value

    return mutate


def delete_at(keys: list[Any]) -> Callable[[Inventory], None]:
    def mutate(inventory: Inventory) -> None:
        target = inventory
        for key in keys[:-1]:
            target = target[key]
        del target[keys[-1]]

    return mutate


def test_schema_is_valid_draft_2020_12() -> None:
    Draft202012Validator.check_schema(SCHEMA)


@pytest.mark.parametrize("path", SAMPLES, ids=lambda p: str(p.relative_to(REPO)))
def test_schema_samples_valid(path: Path) -> None:
    VALIDATOR.validate(load(path))


@pytest.mark.parametrize(
    ("mutate", "validator", "error_path"),
    [
        pytest.param(
            set_at(["endpoints", 0, "authentication", "value"], "sso"),
            "enum",
            ["endpoints", 0, "authentication", "value"],
            id="authentication-value-outside-core-classification",
        ),
        pytest.param(
            set_at(["coverage"], "best-effort"),
            "type",
            ["coverage_note"],
            id="best-effort-without-note",
        ),
        pytest.param(
            set_at(["discovery_mode"], "static"),
            "const",
            ["coverage"],
            id="static-claims-complete",
        ),
        pytest.param(
            set_at(["generated_at"], "2026-10-09"),
            "additionalProperties",
            [],
            id="extra-root-key",
        ),
        pytest.param(
            set_at(["endpoints", 0, "verdict"], "ok"),
            "additionalProperties",
            ["endpoints", 0],
            id="extra-endpoint-key",
        ),
        pytest.param(
            delete_at(["endpoints", 0, "unknown_reason"]),
            "required",
            ["endpoints", 0],
            id="missing-key",
        ),
        pytest.param(
            set_at(["endpoints", 0, "method"], "TRACE"),
            "enum",
            ["endpoints", 0, "method"],
            id="method-trace",
        ),
        pytest.param(
            set_at(["endpoints", 0, "authorization", "layer"], "view"),
            "enum",
            ["endpoints", 0, "authorization", "layer"],
            id="layer-outside-enum",
        ),
        pytest.param(
            set_at(["endpoints", 0, "authorization", "rule"], "custom:x"),
            "anyOf",
            ["endpoints", 0, "authorization", "rule"],
            id="rule-without-builtin-or-recognition-prefix",
        ),
        pytest.param(
            set_at(["endpoints", 5, "unknown_reason"], ""),
            "anyOf",
            ["endpoints", 5, "unknown_reason"],
            id="acknowledged-unknown-without-reason",
        ),
        pytest.param(
            delete_at(["endpoints", 0, "authentication", "rule"]),
            "required",
            ["endpoints", 0, "authentication"],
            id="authentication-without-rule",
        ),
        pytest.param(
            set_at(["endpoints", 5, "authorization", "rule"], "builtin:IsAdminUser"),
            "type",
            ["endpoints", 5, "authorization", "rule"],
            id="unknown-value-with-rule",
        ),
        pytest.param(
            set_at(["endpoints", 0, "authentication", "rule"], None),
            "type",
            ["endpoints", 0, "authentication", "rule"],
            id="known-value-without-rule",
        ),
        pytest.param(
            set_at(["endpoints", 0, "unknown_reason"], "not modelled"),
            "anyOf",
            ["endpoints", 0],
            id="reason-on-endpoint-without-unknown",
        ),
        pytest.param(
            set_at(["project_dimensions", "access_tier"], []),
            "minItems",
            ["project_dimensions", "access_tier"],
            id="dimension-without-values",
        ),
        pytest.param(
            set_at(["project_dimensions", "access_tier"], ["public", "public"]),
            "uniqueItems",
            ["project_dimensions", "access_tier"],
            id="dimension-with-duplicate-values",
        ),
    ],
)
def test_schema_rejects(
    mutate: Callable[[Inventory], None], validator: str, error_path: list[Any]
) -> None:
    inventory = load(CANONICAL)
    VALIDATOR.validate(inventory)
    mutate(inventory)

    errors = list(VALIDATOR.iter_errors(inventory))

    assert [(e.validator, list(e.absolute_path)) for e in errors] == [
        (validator, error_path)
    ]


def test_canonical_input_describes_the_canonical_inventory() -> None:
    neutral = load(REPO / "schema" / "samples" / "canonical.input.json")
    neutral["endpoints"].sort(key=lambda e: (e["path"], e["method"], e["handler"]))

    assert neutral == load(CANONICAL)
