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
    from shop.roles import GROUP_PERMISSIONS

    return [
        {"id": g, "kind": "group", "at": line_of(ROOT, "shop/roles.py", f'"{g}": [')}
        for g in GROUP_PERMISSIONS
    ]


def includes() -> list[Fact]:
    at = line_of(ROOT, "shop/signin.py", "user.groups.add(")
    return [{"role": "manager", "includes": "clerk", "at": at}]


def staff() -> list[Fact]:
    return [
        {"role": "clerk", "at": line_of(ROOT, "shop/signin.py", "user.is_staff = True")}
    ]


def grants() -> list[Fact]:
    from shop.roles import GROUP_PERMISSIONS

    return [
        {"permission": p, "role": g, "at": line_of(ROOT, "shop/roles.py", f'"{g}": [')}
        for g, permissions in GROUP_PERMISSIONS.items()
        for p in permissions
    ]


def scopes() -> list[Fact]:
    return []


def scoped() -> list[Fact]:
    at = line_of(ROOT, "shop/admin.py", "owner=request.user")
    return [
        {
            "capability": "shop.order.view",
            "role": "clerk",
            "scope": "shop.order.get_queryset",
            "at": at,
        }
    ]


def capabilities() -> list[Fact]:
    return []


# --- end project ---
