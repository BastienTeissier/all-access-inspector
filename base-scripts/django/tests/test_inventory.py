import json
from dataclasses import replace
from pathlib import Path

import pytest

from access_inspector.inventory import (
    Axis,
    Endpoint,
    Inventory,
    ValidationError,
    from_dict,
    to_canonical_json,
    validate,
)

SAMPLES = Path(__file__).resolve().parents[3] / "schema" / "samples"


def load(name: str) -> Inventory:
    return from_dict(json.loads((SAMPLES / name).read_text(encoding="utf-8")))


def endpoint(method: str, path: str, handler: str = "shop/views.py:1") -> Endpoint:
    axis = Axis("anonymous", "framework-default", None, "builtin:no_check")
    return Endpoint(
        method,
        path,
        handler,
        axis,
        replace(axis, value="none"),
        {"access_tier": "public"},
    )


def test_inventory_canonical_bytes() -> None:
    expected = (SAMPLES / "canonical.json").read_bytes()
    assert to_canonical_json(load("canonical.input.json")).encode("utf-8") == expected


def test_inventory_canonical_bytes_empty() -> None:
    inventory = load("canonical-empty.json")
    assert (
        to_canonical_json(inventory).encode("utf-8")
        == (SAMPLES / "canonical-empty.json").read_bytes()
    )


def test_inventory_sort() -> None:
    shuffled = [
        endpoint("GET", "/a/b"),
        endpoint("POST", "/a", "z.py:1"),
        endpoint("DELETE", "/a"),
        endpoint("POST", "/a", "a.py:1"),
        endpoint("ANY", "/a"),
    ]
    inventory = replace(load("canonical.input.json"), endpoints=shuffled)
    lines = to_canonical_json(inventory).splitlines()
    order = [
        (e["method"], e["path"], e["handler"])
        for e in map(json.loads, (line.strip(" ,") for line in lines[10:15]))
    ]
    assert order == [
        ("ANY", "/a", "shop/views.py:1"),
        ("DELETE", "/a", "shop/views.py:1"),
        ("POST", "/a", "a.py:1"),
        ("POST", "/a", "z.py:1"),
        ("GET", "/a/b", "shop/views.py:1"),
    ]


def test_inventory_validate_accepts_the_canonical_sample() -> None:
    validate(load("canonical.input.json"))


def test_inventory_validate_dimension_keys() -> None:
    base = load("canonical.input.json")
    stray = replace(
        endpoint("GET", "/orders/"),
        dimensions={"access_tier": "public", "team": "sales"},
    )
    with pytest.raises(
        ValidationError, match=r"GET /orders/ \(shop/views.py:1\): dimensions"
    ):
        validate(replace(base, endpoints=[stray]))


def test_inventory_validate_dimension_value() -> None:
    base = load("canonical.input.json")
    stray = replace(endpoint("GET", "/orders/"), dimensions={"access_tier": "partner"})
    with pytest.raises(ValidationError, match="access_tier='partner' is not declared"):
        validate(replace(base, endpoints=[stray]))


@pytest.mark.parametrize(
    "values",
    [
        pytest.param([], id="empty"),
        pytest.param(["public", "public"], id="duplicate"),
        pytest.param([""], id="empty-value"),
    ],
)
def test_inventory_validate_dimension_values_list(values: list[str]) -> None:
    with pytest.raises(ValidationError, match="dimension tier needs"):
        validate(
            replace(
                load("canonical.input.json"),
                project_dimensions={"tier": values},
                endpoints=[],
            )
        )


def test_inventory_validate_coverage_note() -> None:
    with pytest.raises(ValidationError, match="requires a coverage_note"):
        validate(
            replace(
                load("canonical.input.json"), coverage="best-effort", coverage_note=None
            )
        )


def test_inventory_validate_static_is_best_effort() -> None:
    with pytest.raises(ValidationError, match="static discovery"):
        validate(replace(load("canonical.input.json"), discovery_mode="static"))


@pytest.mark.parametrize(
    ("change", "message"),
    [
        pytest.param({"method": "TRACE"}, "method 'TRACE'", id="method"),
        pytest.param({"path": "orders/"}, "path must start with /", id="path"),
        pytest.param(
            {"authentication": Axis("sso", None, None, "builtin:x")},
            "outside the Core Classification",
            id="value",
        ),
        pytest.param(
            {"authentication": Axis("anonymous", "view", None, "builtin:x")},
            "layer 'view'",
            id="layer",
        ),
        pytest.param(
            {"authentication": Axis("unknown", None, None, "builtin:x")},
            "unknown value has no rule",
            id="rule",
        ),
        pytest.param(
            {"unknown_reason": "custom"},
            "unknown_reason must",
            id="reason-without-unknown",
        ),
    ],
)
def test_inventory_validate_endpoint(change: dict[str, object], message: str) -> None:
    bad = replace(endpoint("GET", "/orders/"), **change)  # type: ignore[arg-type]
    with pytest.raises(ValidationError, match=message):
        validate(replace(load("canonical.input.json"), endpoints=[bad]))


def test_inventory_validate_duplicate() -> None:
    twice = [endpoint("GET", "/orders/"), endpoint("GET", "/orders/")]
    with pytest.raises(ValidationError, match="duplicate endpoint GET /orders/"):
        validate(replace(load("canonical.input.json"), endpoints=twice))
