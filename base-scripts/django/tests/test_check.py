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
