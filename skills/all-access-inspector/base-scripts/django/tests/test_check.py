import json
from dataclasses import replace
from pathlib import Path

from access_inspector.inventory import Axis, Inventory, Pin, check, from_dict

SAMPLES = Path(__file__).resolve().parents[3] / "schema" / "samples"


def load(name: str) -> Inventory:
    return from_dict(json.loads((SAMPLES / name).read_text(encoding="utf-8")))


def test_check_ignores_ordering_and_whitespace() -> None:
    assert check(load("canonical.input.json"), load("canonical.json")) == []


def test_check_diff() -> None:
    committed = load("canonical.json")
    gone, kept, *rest = committed.endpoints
    changed = replace(
        kept, authentication=replace(kept.authentication, value="optional")
    )
    unknown = Axis("unknown", None, None, None)
    added = replace(
        gone,
        path="/hooks/",
        authentication=unknown,
        authorization=unknown,
        unknown_reason="custom hook",
    )
    diff = check(committed, replace(committed, endpoints=[changed, added, *rest]))
    assert f"- {gone.label()}" in diff
    assert (
        f"+ {added.label()} authentication=unknown authorization=unknown [unknown]"
        in diff
    )
    assert (
        f"~ {kept.label()} authentication.value: {kept.authentication.value} -> optional"
        in diff
    )
    assert len(diff) == 3


def test_check_header_change() -> None:
    committed = load("canonical.json")
    current = replace(committed, project_dimensions={"access_tier": ["public"]})
    old = json.dumps(committed.project_dimensions)
    assert check(committed, current) == [
        f'~ project_dimensions: {old} -> {{"access_tier": ["public"]}}'
    ]


def test_check_compares_values_as_written() -> None:
    hosts = Pin("ALLOWED_HOSTS", ("shop.example.com",), "production value")
    current = load("canonical.json")
    current = replace(
        current,
        boot_environment=replace(current.boot_environment, pinned=[hosts]),
    )
    as_list = replace(hosts, value=["shop.example.com"])
    committed = replace(
        current,
        boot_environment=replace(current.boot_environment, pinned=[as_list]),
    )
    assert check(committed, current) == []


def test_check_flags_a_duplicated_committed_entry() -> None:
    current = load("canonical.json")
    first = current.endpoints[0]
    committed = replace(current, endpoints=[first, *current.endpoints])
    assert check(committed, current) == [f"- {first.label()} (duplicate entry)"]


def test_check_ignores_expected_access_key_order() -> None:
    current = load("canonical.json")
    reordered = {
        d: {v: dict(reversed(x.items())) for v, x in reversed(by_value.items())}
        for d, by_value in current.expected_access.items()
    }
    assert check(replace(current, expected_access=reordered), current) == []


def test_check_new_fields() -> None:
    committed = load("canonical.json")
    first = committed.endpoints[0]
    changed = replace(
        first,
        authentication=replace(first.authentication, evidence="a.py:1"),
        acknowledged=not first.acknowledged,
    )
    expected = {
        "access_tier": {"public": committed.expected_access["access_tier"]["public"]}
    }
    current = replace(committed, expected_access=expected, endpoints=[changed])
    diff = check(replace(committed, endpoints=[first]), current)
    assert diff == [
        f"~ expected_access: {json.dumps(committed.expected_access)} -> {json.dumps(expected)}",
        f"~ {first.label()} authentication.evidence: {first.authentication.evidence or 'null'} -> a.py:1",
        f"~ {first.label()} acknowledged: {json.dumps(first.acknowledged)} -> {json.dumps(changed.acknowledged)}",
    ]
