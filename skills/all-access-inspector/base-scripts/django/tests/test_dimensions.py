import pytest

from access_inspector.dimensions import Assign, MissingDimension, assign
from access_inspector.inventory import Axis, Endpoint

DIMENSIONS = {"access_tier": ["public", "customer", "staff"]}
RULES = [
    Assign("access_tier", "staff", lambda e: e.path.startswith("/api/admin/")),
    Assign("access_tier", "customer", lambda e: e.path.startswith("/api/")),
]


def endpoint(path: str) -> Endpoint:
    axis = Axis("anonymous", "framework-default", None, "builtin:no_check")
    return Endpoint("GET", path, "shop/views.py:1", axis, axis)


def test_dimensions_assign_first_rule_wins() -> None:
    assert assign(endpoint("/api/admin/users/"), DIMENSIONS, RULES) == {
        "access_tier": "staff"
    }
    assert assign(endpoint("/api/orders/"), DIMENSIONS, RULES) == {
        "access_tier": "customer"
    }


def test_dimensions_assign_missing() -> None:
    with pytest.raises(
        MissingDimension,
        match=r"GET /about/ \(shop/views.py:1\): no rule assigns dimension 'access_tier'",
    ):
        assign(endpoint("/about/"), DIMENSIONS, RULES)


def test_dimensions_none_declared() -> None:
    assert assign(endpoint("/about/"), {}, []) == {}
