import sys
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest

from access_map import admin


def test_model_action_names() -> None:
    names = {a: admin.action_name(a, "order", "orders") for a in admin.ACTIONS}

    assert names == {
        "view": "View orders",
        "add": "Add order",
        "change": "Change order",
        "delete": "Delete order",
    }


def test_model_without_verbose_name_uses_django_default() -> None:
    # Django derives `email whitelist entrys` for EmailWhitelistEntry: kept verbatim.
    name = admin.action_name("view", "email whitelist entry", "email whitelist entrys")

    assert name == "View email whitelist entrys"


def test_custom_action_short_description_else_function_name() -> None:
    def export_view(request: Any) -> None: ...

    def refund_view(request: Any) -> None: ...

    refund_view.short_description = "Refund order"  # type: ignore[attr-defined]

    assert admin.view_name(export_view) == "export_view"
    assert admin.view_name(refund_view) == "Refund order"


def test_custom_view_resolves_a_uuid_parameter(monkeypatch: pytest.MonkeyPatch) -> None:
    def export_view(request: Any) -> None: ...

    # A URLconf holding one `<uuid:pk>/export/` admin view: Django itself is not installed here.
    urls = ModuleType("django.urls")
    urls.Resolver404 = type("Resolver404", (Exception,), {})  # type: ignore[attr-defined]

    def resolve(path: str) -> SimpleNamespace:
        if path != "/admin/shop/order/00000000-0000-0000-0000-000000000000/export/":
            raise urls.Resolver404(path)
        return SimpleNamespace(func=export_view)

    urls.resolve = resolve  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "django", ModuleType("django"))
    monkeypatch.setitem(sys.modules, "django.urls", urls)

    assert admin.view_of("/admin/shop/order/{pk}/export/") is export_view
    assert admin.view_of("/admin/shop/order/{pk}/missing/") is None


def test_areas_one_per_admin_model_with_name_and_at() -> None:
    introspect = object.__new__(admin.Introspect)
    order = {"model": "shop.order", "plural": "orders", "model_at": "shop/models.py:8"}
    introspect.admins = [
        {**order, "prefix": "/admin/shop/order/"},
        {
            **order,
            "prefix": "/backoffice/shop/order/",
        },  # the same model on a second site
        {"model": "shop.product", "plural": "products", "model_at": "shop/models.py:4"},
    ]

    assert introspect.areas() == [
        {"id": "shop.order", "name": "orders", "at": "shop/models.py:8"},
        {"id": "shop.product", "name": "products", "at": "shop/models.py:4"},
    ]
