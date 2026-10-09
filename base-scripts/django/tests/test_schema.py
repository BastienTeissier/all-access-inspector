import copy
import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator, ValidationError

REPO = Path(__file__).resolve().parents[3]
SCHEMA = json.loads(
    (REPO / "schema" / "inventory.schema.json").read_text(encoding="utf-8")
)
SAMPLES = sorted(
    [
        *(REPO / "schema" / "samples").glob("*.json"),
        *(REPO / "fixtures").glob("*/expected/inventory.json"),
    ]
)


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def test_schema_is_valid_draft_2020_12() -> None:
    Draft202012Validator.check_schema(SCHEMA)


@pytest.mark.parametrize("path", SAMPLES, ids=lambda p: str(p.relative_to(REPO)))
def test_schema_samples_valid(path: Path) -> None:
    Draft202012Validator(SCHEMA).validate(load(path))


def test_schema_rejects_value_outside_core_classification() -> None:
    inventory = copy.deepcopy(load(REPO / "schema" / "samples" / "canonical.json"))
    inventory["endpoints"][0]["authentication"]["value"] = "sso"

    with pytest.raises(ValidationError):
        Draft202012Validator(SCHEMA).validate(inventory)


def test_schema_requires_coverage_note_when_best_effort() -> None:
    inventory = copy.deepcopy(load(REPO / "schema" / "samples" / "canonical.json"))
    inventory["coverage"] = "best-effort"

    with pytest.raises(ValidationError):
        Draft202012Validator(SCHEMA).validate(inventory)


def test_schema_requires_best_effort_when_static() -> None:
    inventory = copy.deepcopy(load(REPO / "schema" / "samples" / "canonical.json"))
    inventory["discovery_mode"] = "static"

    with pytest.raises(ValidationError):
        Draft202012Validator(SCHEMA).validate(inventory)
