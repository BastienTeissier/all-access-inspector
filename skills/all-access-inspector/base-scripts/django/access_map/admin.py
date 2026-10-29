"""What the admin registry enforces, per inventory endpoint; Django-bound, runs only in a booted project."""

from __future__ import annotations

import inspect
import re
import sys
from pathlib import Path
from typing import Any, Callable

from access_map import project

ACCESS_METHODS = (
    "has_module_permission",
    "has_view_permission",
    "has_add_permission",
    "has_change_permission",
    "has_delete_permission",
    "get_queryset",
    "changelist_view",
    "add_view",
    "change_view",
    "delete_view",
    "history_view",
    "get_urls",
    "save_related",
    "formfield_for_manytomany",
)
ACTIONS = ("view", "add", "change", "delete")
VIEW_OR_CHANGE = ["has_view_permission", "has_change_permission"]
# admin URL suffix after /<site>/<app>/<model>/ -> (page, permission action, methods it calls)
ADMIN_PAGES: dict[str, tuple[str, str, list[str]]] = {
    "": ("list", "view", VIEW_OR_CHANGE),
    "add/": ("add form", "add", ["has_add_permission"]),
    "{object_id}/change/": ("edit form", "change", VIEW_OR_CHANGE),
    "{object_id}/delete/": ("delete", "delete", ["has_delete_permission"]),
    "{object_id}/history/": ("history", "view", VIEW_OR_CHANGE),
}
PAGE_VIEW = {
    "list": "changelist_view",
    "add form": "add_view",
    "edit form": "change_view",
    "delete": "delete_view",
    "history": "history_view",
}
PERMISSION = re.compile(r"^[a-z_]+\.[a-z_]+$")
PERMISSION_IN_SOURCE = re.compile(r'"(\w+)\."\s*\+\s*([A-Z_]+)')
INTROSPECTION = "admin introspection"
UNDECIDED = {
    "kind": "custom",
    "basis": "open",
    "how": "An override decides with no permission the build recognises.",
}
ABOUT = {
    "reads": "The admin registry of every mounted admin site, each ModelAdmin's class hierarchy"
    " and the project's Map Rules, as the booted settings load them.",
    "holds": [
        "Roles, grants, scopes and capabilities from the Map Rules in tools/access-map/project.py",
        "Every admin model page as a capability, its model as an area",
        "Every admin URL: which has_*_permission Django calls for it, and the first-party "
        "overrides of those methods with source and file:line",
        "Permissions each endpoint checks, and the stack's reading of superuser-only and staff rules",
    ],
    "heuristics": [
        "Admin URL → which has_*_permission Django calls (from the URL suffix)",
        'Permissions found in override code by pattern ("app." + CONSTANT)',
        "An override ending in `return False` → nobody; `return request.user.is_superuser`"
        " → superuser; `raise Http404` in the page view → page off",
        "A get_queryset override → a scope candidate",
    ],
    "command": "python tools/access-map/introspect.py",
}

Who = dict[str, str]
Layer = dict[str, Any]
Override = dict[str, str]
Admin = dict[str, Any]


def relative(file: str) -> str:
    """A source file from the project root, or from the import path entry that holds it."""
    path = Path(file).resolve()
    if path.is_relative_to(project.ROOT) and "site-packages" not in path.parts:
        return path.relative_to(project.ROOT).as_posix()
    for entry in sorted(
        (Path(p).resolve() for p in sys.path if p), key=lambda p: -len(p.parts)
    ):
        if path.is_relative_to(entry):
            return path.relative_to(entry).as_posix()
    return path.name


def is_first_party(obj: object) -> bool:
    module = getattr(obj, "__module__", "") or ""
    if project.FIRST_PARTY:
        return module.split(".")[0] in project.FIRST_PARTY
    file = getattr(sys.modules.get(module), "__file__", None)
    if not file:
        return False
    path = Path(file).resolve()
    return path.is_relative_to(project.ROOT) and "site-packages" not in path.parts


def location(func: Callable[..., Any] | type) -> dict[str, str]:
    func = inspect.unwrap(func)
    lines, start = inspect.getsourcelines(func)
    return {
        "at": f"{relative(inspect.getsourcefile(func) or '')}:{start}",
        "source": "".join(lines[:14]).rstrip(),
    }


def superuser_role() -> dict[str, Any]:
    """Django's own superuser: every permission check passes for it."""
    from django.contrib.auth.models import PermissionsMixin

    source, start = inspect.getsourcelines(PermissionsMixin)
    line = next(i for i, text in enumerate(source) if "is_superuser" in text)
    at = f"{relative(inspect.getsourcefile(PermissionsMixin) or '')}:{start + line}"
    return {"id": "superuser", "kind": "superuser", "at": at, "basis": "extracted"}


def admin_entries() -> list[Admin]:
    """Every ModelAdmin of a mounted admin site: URL prefix, permission per action, first-party overrides."""
    from django.contrib.admin.sites import all_sites
    from django.contrib.auth import get_permission_codename
    from django.urls import NoReverseMatch, reverse

    entries = []
    for site in sorted(all_sites, key=lambda s: s.name):
        for model, model_admin in site._registry.items():
            opts = model._meta
            try:
                prefix = reverse(
                    f"{site.name}:{opts.app_label}_{opts.model_name}_changelist"
                )
            except NoReverseMatch:  # the site is not mounted
                continue
            cls = type(model_admin)
            overrides: dict[str, list[Override]] = {}
            for name in ACCESS_METHODS:
                chain = []  # every first-party definition down to the first framework one
                for owner in (c for c in cls.__mro__ if name in c.__dict__):
                    if not is_first_party(owner):
                        break
                    chain.append(
                        {"owner": owner.__qualname__, **location(owner.__dict__[name])}
                    )
                if chain:
                    overrides[name] = chain
            entries.append(
                {
                    "prefix": prefix,
                    "model": f"{opts.app_label}.{opts.model_name}",
                    "term": opts.object_name,
                    "admin_at": location(cls)["at"] if is_first_party(cls) else None,
                    "at": location(cls if is_first_party(cls) else model)["at"],
                    "permissions": {
                        action: f"{opts.app_label}.{get_permission_codename(action, opts)}"
                        for action in ACTIONS
                    },
                    "overrides": overrides,
                }
            )
    return sorted(entries, key=lambda a: (-len(a["prefix"]), a["prefix"]))


def constants() -> dict[str, str]:
    found = {}
    for rel in project.CONSTANT_FILES:
        text = (project.ROOT / rel).read_text(encoding="utf-8")
        for name, value in re.findall(r'^([A-Z_]+) = "([a-z_]+)"', text, re.M):
            found[name] = value
    return found


def rule_name(axis: dict[str, Any]) -> str:
    rule = axis["rule"] or ""
    return rule[len("recognition:") :] if rule.startswith("recognition:") else rule


def from_axis(axis: dict[str, Any]) -> Who:
    if (axis["rule"] or "").startswith("builtin:"):
        return {"basis": "extracted", "how": f"Inventory: {axis['raw'] or 'no check'}"}
    return {
        "basis": "rule",
        "how": f"Recognition rule {rule_name(axis)} ({axis['evidence']})",
    }


def fallback(endpoint: dict[str, Any]) -> Who | None:
    """The stack's reading of the authorization rule, when grants and admin do not decide."""
    authz = endpoint["authorization"]
    rule = rule_name(authz)
    if rule in project.SUPERUSER_RULES:
        return {"kind": "superuser", **from_axis(authz)}
    if rule in project.SIGNED_IN_RULES:
        return {"kind": "signed_in", **from_axis(authz)}
    if rule in project.STAFF_RULES or authz["raw"] == "is_staff":
        return {"kind": "staff", **from_axis(authz)}
    return None


def inferred(kind: str, how: str) -> Who:
    return {"kind": kind, "basis": "inferred", "how": how}


def layer(kind: str, title: str, text: str, source: str, **more: Any) -> Layer:
    return {"kind": kind, "title": title, "text": text, "source": source, **more}


def uses(found: list[str], verb: str) -> str:
    return f"; {verb} {', '.join(found)}" if found else ""


def key(endpoint: dict[str, Any]) -> list[str]:
    """The Review Key: method, path, handler with its trailing :<line> stripped."""
    return [
        endpoint["method"],
        endpoint["path"],
        re.sub(r":\d+$", "", endpoint["handler"]),
    ]


class Introspect:
    def __init__(self, admin_actions: dict[str, Any]) -> None:
        self.admins = admin_entries()
        self.admin_actions = admin_actions
        self.constants = constants()
        self.snippets: dict[str, str] = {}

    def snippet(self, override: Override) -> str:
        self.snippets[override["at"]] = override["source"]
        return override["at"]

    def permissions_in(self, source: str) -> list[str]:
        found = PERMISSION_IN_SOURCE.findall(source)
        return [f"{app}.{self.constants[c]}" for app, c in found if c in self.constants]

    def override_layer(self, kind: str, o: Override, method: str, text: str) -> Layer:
        return layer(
            kind, f"{o['owner']}.{method}", text, INTROSPECTION, at=self.snippet(o)
        )

    def permission_layers(
        self, admin: Admin, methods: list[str]
    ) -> tuple[list[Layer], list[str], set[str], list[list[str]]]:
        """One layer per permission method the page calls, as Django or an override decides it."""
        overrides: dict[str, list[Override]] = admin["overrides"]
        permission = {f"has_{a}_permission": admin["permissions"][a] for a in ACTIONS}
        layers: list[Layer] = []
        permissions: list[str] = []
        outcomes: set[str] = set()
        notes: list[list[str]] = []
        for position, method in enumerate(methods):
            either = "Or, instead of the step above: " if position else ""
            chain = overrides.get(method)
            if not chain:
                permissions.append(permission[method])
                outcomes.add("perm")
                text = f"{either}user.has_perm({permission[method]})"
                layers.append(
                    layer(
                        "permission",
                        f"Django {method}",
                        text,
                        INTROSPECTION,
                        at=admin["admin_at"],
                    )
                )
                continue
            top = chain[0]["source"]
            found = [c for o in chain for c in self.permissions_in(o["source"])]
            if re.search(r"return False\s*$", top):
                outcomes.add("nobody")
            elif re.search(r"return request\.user\.is_superuser\s*$", top):
                outcomes.add("superuser")
            elif found:
                permissions += found
                outcomes.add("perm")
                notes.append(
                    ["inferred", "permissions found by pattern in override code"]
                )
            else:
                outcomes.add("custom")
            for o in chain:
                text = (
                    either
                    + "Overrides Django's check"
                    + uses(self.permissions_in(o["source"]), "uses")
                )
                layers.append(self.override_layer("permission", o, method, text))
        return layers, permissions, outcomes, notes

    def admin_layers(
        self, endpoint: dict[str, Any], admin: Admin
    ) -> tuple[list[Layer], list[str], Who | None, list[list[str]]]:
        suffix = endpoint["path"][len(admin["prefix"]) :]
        overrides: dict[str, list[Override]] = admin["overrides"]
        page = ADMIN_PAGES.get(suffix)
        custom = self.admin_actions.get(endpoint["path"])
        if suffix == "{object_id}/":
            text = "Redirects to the edit form; the edit form decides."
            how = "The redirect only needs is_staff. The edit form behind it decides."
            return (
                [layer("view", "Redirect", text, "django")],
                [],
                inferred("staff", how),
                [],
            )
        if page is None and custom is None:
            handler = endpoint["handler"]
            text = "Handler decides; not mapped to a permission action."
            at = handler if re.search(r":\d+$", handler) else None
            who = {
                "kind": "custom",
                "basis": "open",
                "how": "Not resolved: the handler decides and no mapping says how.",
            }
            return (
                [layer("view", "Custom admin view", text, "inventory", at=at)],
                [],
                who,
                [],
            )
        layers: list[Layer] = []
        notes: list[list[str]] = []
        if custom:
            label, action = "custom view", custom["action"]
            methods = [f"has_{action}_permission"]
            layers.append(
                layer(
                    "view",
                    "Custom admin view",
                    custom["text"],
                    "curated",
                    at=custom["at"],
                )
            )
            notes.append(["curated", f"{custom['at']} maps this URL to {methods[0]}"])
        else:
            assert page is not None
            label, action, methods = page
        more, permissions, outcomes, more_notes = self.permission_layers(admin, methods)
        layers += more
        notes += more_notes
        verdict: Who | None
        if "perm" in outcomes:
            verdict = UNDECIDED if "custom" in outcomes else None
        elif "custom" in outcomes:
            verdict = UNDECIDED
        elif "superuser" in outcomes:
            verdict = inferred(
                "superuser", "Override ends with `return request.user.is_superuser`."
            )
        else:
            verdict = inferred("nobody", "Override ends with `return False`.")
        view_method = PAGE_VIEW.get(label)
        for o in overrides.get(view_method or "", []):
            dead = "raise Http404" in o["source"]
            if dead:
                verdict = inferred(
                    "nobody", f"{o['owner']}.{view_method} contains `raise Http404`."
                )
            text = (
                "Page switched off: raises 404" if dead else "Overrides the page view"
            )
            layers.append(self.override_layer("view", o, view_method or "", text))
        if action != "add":
            for o in overrides.get("get_queryset", []):
                found = self.permissions_in(o["source"])
                text = "Narrows which records exist for this user" + uses(
                    found, "widened by"
                )
                layers.append(
                    {
                        **self.override_layer("scope", o, "get_queryset", text),
                        "permissions": found,
                    }
                )
        if label in ("edit form", "add form"):
            for method in ("formfield_for_manytomany", "save_related"):
                for o in overrides.get(method, []):
                    found = self.permissions_in(o["source"])
                    text = "Checked when the form is shown or saved" + uses(
                        found, "uses"
                    )
                    layers.append(
                        {
                            **self.override_layer("write", o, method, text),
                            "permissions": found,
                        }
                    )
        return layers, sorted(set(permissions)), verdict, notes

    def admin_of(self, path: str) -> Admin | None:
        return next((a for a in self.admins if path.startswith(a["prefix"])), None)

    def endpoint(self, endpoint: dict[str, Any]) -> dict[str, Any] | None:
        """What the runtime adds to one inventory endpoint, or None when it adds nothing."""
        path = endpoint["path"]
        admin = self.admin_of(path)
        layers: list[Layer] = []
        permissions: list[str] = []
        verdict: Who | None = None
        notes: list[list[str]] = []
        if admin:
            layers, permissions, verdict, notes = self.admin_layers(endpoint, admin)
        raw = endpoint["authorization"]["raw"] or ""
        if PERMISSION.match(raw):
            permissions = sorted({*permissions, raw})
        rule_fallback = fallback(endpoint)
        if not (admin or permissions or rule_fallback):
            return None
        return {
            "method": endpoint["method"],
            "path": path,
            "handler": endpoint["handler"],
            **({"resource": f"Back office · {admin['model']}"} if admin else {}),
            "layers": layers,
            "permissions": permissions,
            "verdict": verdict,
            "fallback": rule_fallback,
            "notes": notes,
        }

    def check(self, admin: Admin, action: str) -> str:
        """The permission an action needs, or the override that decides it instead."""
        method = f"has_{action}_permission"
        chain = admin["overrides"].get(method)
        if not chain:
            return str(admin["permissions"][action])
        found = [c for o in chain for c in self.permissions_in(o["source"])]
        return f"{chain[0]['owner']}.{method}" + uses(found, "uses")

    def capabilities(self, endpoints: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Each admin model page as a capability: one per permission action, its model as the area;
        each custom admin URL of `stack.admin_actions` as one more."""
        found: dict[str, dict[str, Any]] = {}
        for admin in self.admins:
            for action in ACTIONS:
                keys = [
                    key(e)
                    for e in endpoints
                    if e["method"] != "HEAD"
                    and e["path"].startswith(admin["prefix"])
                    and ADMIN_PAGES.get(e["path"][len(admin["prefix"]) :], ("", ""))[1]
                    == action
                    and self.admin_of(e["path"]) is admin
                ]
                if not keys:
                    continue
                cap_id = f"{admin['model']}.{action}"
                if cap_id in found:  # the same model on a second admin site
                    cap_id = f"{admin['prefix'].strip('/').replace('/', '.')}.{action}"
                found[cap_id] = {
                    "id": cap_id,
                    "area": admin["model"],
                    "term": admin["term"],
                    "verb": "read" if action == "view" else "write",
                    "endpoints": sorted(keys),
                    "check": self.check(admin, action),
                    "at": admin["at"],
                    "basis": "extracted",
                }
        for path, custom in self.admin_actions.items():
            custom_admin = self.admin_of(path)
            keys = [
                key(e) for e in endpoints if e["method"] != "HEAD" and e["path"] == path
            ]
            if not (custom_admin and keys):
                continue
            suffix = path[len(custom_admin["prefix"]) :].strip("/").split("/")
            name = ".".join(s for s in suffix if not s.startswith("{"))
            cap_id = f"{custom_admin['model']}.{name}"
            found[cap_id] = {
                "id": cap_id,
                "area": custom_admin["model"],
                "term": custom_admin["term"],
                "verb": "read" if custom["action"] == "view" else "write",
                "endpoints": sorted(keys),
                "check": self.check(custom_admin, custom["action"]),
                "at": custom["at"],
                "basis": "extracted",
            }
        return list(found.values())

    def scope_candidates(self) -> list[dict[str, Any]]:
        """Each first-party get_queryset override: a filter a Map Rule can attach to a role."""
        return [
            {
                "id": f"{admin['model']}.get_queryset",
                "label": f"{admin['overrides']['get_queryset'][0]['owner']}.get_queryset",
                "at": admin["overrides"]["get_queryset"][0]["at"],
                "basis": "inferred",
            }
            for admin in self.admins
            if "get_queryset" in admin["overrides"]
        ]
