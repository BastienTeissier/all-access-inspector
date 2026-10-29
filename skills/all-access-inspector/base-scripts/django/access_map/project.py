"""Map Rules: the facts this project declares in a form a program can read, each with its file:line.

Read before you write: a role, grant, scope or capability the code declares goes here, never in
vocabulary.json. Every rule returns plain dicts, each with `at` (`path:line` from the project
root, found with `line_of`). The introspect adds basis `rule` to them, `inferred` to scopes.

Project code goes only in the project section. Everything else stays byte-identical to the
Base Script.
"""

from __future__ import annotations

from typing import Any

from access_inspector.boot import ROOT
from access_map.runtime import line_of

Fact = dict[str, Any]

__all__ = ["ROOT", "Fact", "line_of"]

# --- project ---
# Top-level packages whose admin classes and overrides are the project's own; empty means
# every module whose file is under the project root and outside site-packages.
FIRST_PARTY: tuple[str, ...] = ()

# Files holding `NAME = "codename"` constants that override code uses as `"app." + NAME`.
CONSTANT_FILES: tuple[str, ...] = ()

# Recognition Rules (tools/access-inspector/rules.py names) that end in superusers only, or
# let any signed-in user through.
SUPERUSER_RULES: frozenset[str] = frozenset()
SIGNED_IN_RULES: frozenset[str] = frozenset()


def roles() -> list[Fact]:
    """Roles: {id, kind: group|signed_in|superuser, at}. The superuser role is read already.

    A Django Group per key of a grants dict:
        from shop.roles import GROUP_PERMISSIONS
        return [
            {"id": g, "kind": "group", "at": line_of(ROOT, "shop/roles.py", f'"{g}": [')}
            for g in GROUP_PERMISSIONS
        ]
    """
    return []


def includes() -> list[Fact]:
    """{role, includes, at}: every account of `role` also holds `includes`.

    A sign-in adapter that adds every account to one group:
        at = line_of(ROOT, "core/adapter.py", "user.groups.add(")
        return [{"role": r["id"], "includes": "user", "at": at} for r in roles() if r["id"] != "user"]
    """
    return []


def staff() -> list[Fact]:
    """{role, at}: accounts of `role` pass is_staff checks.

    A sign-in adapter that makes every account staff:
        return [{"role": "user", "at": line_of(ROOT, "core/adapter.py", "user.is_staff = True")}]
    """
    return []


def grants() -> list[Fact]:
    """{permission, role, at}: `role` holds `permission` (app_label.codename).

    The same grants dict as roles():
        from shop.roles import GROUP_PERMISSIONS
        return [
            {"permission": p, "role": g, "at": line_of(ROOT, "shop/roles.py", f'"{g}": [')}
            for g, permissions in GROUP_PERMISSIONS.items()
            for p in permissions
        ]
    """
    return []


def scopes() -> list[Fact]:
    """{id, label, at}: a filter on which records a role sees. Admin get_queryset overrides are read already.

    A queryset filtered on the user's subsidiary:
        at = line_of(ROOT, "core/querysets.py", "subsidiary=request.user.subsidiary")
        return [{"id": "own-subsidiary", "label": "Own subsidiary", "at": at}]
    """
    return []


def scoped() -> list[Fact]:
    """{capability, role, scope, at}: `scope` narrows `capability` for `role`.

    The admin list of orders, filtered by owner unless the user may change every order:
        at = line_of(ROOT, "shop/admin.py", "owner=request.user")
        return [{"capability": "shop.order.view", "role": "clerk", "scope": "shop.order.get_queryset", "at": at}]
    """
    return []


def capabilities() -> list[Fact]:
    """{id, area, term, verb: read|write, endpoints: [[method, path, handler]], check, at}.

    Admin model pages are read already. A view guarded by one permission:
        return [{
            "id": "export-orders", "area": "shop.order", "term": "Order", "verb": "read",
            "endpoints": [["GET", "/orders/export/", "shop/views.py"]],
            "check": "shop.export_order", "at": line_of(ROOT, "shop/views.py", "def export_orders"),
        }]
    """
    return []


# --- end project ---
