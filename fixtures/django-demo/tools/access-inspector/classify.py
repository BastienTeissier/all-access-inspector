"""Read the access checks each endpoint carries: decorators, CBV mixins, DRF permissions, admin, middleware."""

from __future__ import annotations

import inspect
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import django
from django.conf import settings
from django.contrib.auth import mixins
from django.contrib.auth.decorators import (
    login_required,
    permission_required,
    user_passes_test,
)
from django.test import RequestFactory
from django.views.decorators.http import require_http_methods

from access_inspector.discovery import RawEndpoint
from access_inspector.rules import Finding, drf_layer, global_findings

try:
    import rest_framework
    from rest_framework.views import APIView
except ImportError:  # DRF is optional
    rest_framework = None
    APIView = None

FRAMEWORK_DIRS = tuple(
    str(Path(m.__file__).parent) for m in (django, rest_framework) if m is not None
)
FRAMEWORK_MODULES = ("django.", "rest_framework.")
NO_CHECK = "no_check"


@dataclass(frozen=True)
class Classified:
    method: str
    handler: str
    findings: list[Finding]


def classify(raw: RawEndpoint, root: Path) -> list[Classified]:
    callback = raw.callback
    if raw.reason is not None:
        return [_unreadable(callback, raw.reason)]
    middleware = global_findings(
        list(settings.MIDDLEWARE), getattr(callback, "login_required", True)
    )
    # as_view() attributes (cls, view_class, actions, initkwargs) are copied onto every wrapper by functools.wraps.
    view_class = getattr(callback, "view_class", None)
    if hasattr(callback, "admin_site") or hasattr(callback, "model_admin"):
        admin = Finding("django.contrib.admin", "global", "is_staff")
        return [
            Classified(
                "ANY",
                _handler(view_class or inspect.unwrap(callback), root),
                [*middleware, admin],
            )
        ]
    decorators, methods, inner = _unwrap(callback)
    cls = getattr(callback, "cls", None)
    if APIView is not None and isinstance(cls, type) and issubclass(cls, APIView):
        return [
            Classified(m, h, [*middleware, *decorators, *f])
            for m, h, f in _drf(callback, cls, root)
        ]
    if isinstance(view_class, type):
        return [
            Classified(m, _handler(view_class, root), [*middleware, *decorators, *f])
            for m, f in _cbv(view_class)
        ]
    if not (inspect.isfunction(inner) or inspect.ismethod(inner)):
        return [
            _unreadable(
                callback,
                f"{_dotted(callback)} is not a Django view; its access checks are not readable",
            )
        ]
    own = decorators or [Finding(NO_CHECK, "framework-default", None)]
    return [
        Classified(m, _handler(inner, root), [*middleware, *own])
        for m in methods or ["ANY"]
    ]


def _unreadable(callback: Any, reason: str) -> Classified:
    name = _dotted(callback)
    return Classified("ANY", name, [Finding(name, None, name, reason)])


# Reference code objects: a wrapper is identified by identity of its code, never by its name.
def _sync(request: Any) -> None: ...


async def _async(request: Any) -> None: ...


def _codes(decorator: Any) -> set[Any]:
    return {decorator(_sync).__code__, decorator(_async).__code__}


def _closure(fn: Any) -> dict[str, Any]:
    code = getattr(fn, "__code__", None)
    cells = getattr(fn, "__closure__", None) or ()
    return dict(zip(code.co_freevars, (c.cell_contents for c in cells))) if code else {}


USER_PASSES_TEST = _codes(user_passes_test(bool))
REQUIRE_HTTP_METHODS = _codes(require_http_methods(["GET"]))
LOGIN_TEST = _closure(login_required(_sync))["test_func"].__code__
PERMISSION_TEST = _closure(permission_required("app.perm")(_sync))["test_func"].__code__


def _unwrap(fn: Any) -> tuple[list[Finding], list[str] | None, Any]:
    """Walk the __wrapped__ chain: auth decorators become findings, framework wrappers are neutral."""
    findings: list[Finding] = []
    methods: list[str] | None = None
    while (wrapped := getattr(fn, "__wrapped__", None)) is not None:
        code = getattr(fn, "__code__", None)
        if code in USER_PASSES_TEST:
            findings.append(_user_passes_test(_closure(fn)["test_func"]))
        elif code in REQUIRE_HTTP_METHODS:
            declared = {m.upper() for m in _closure(fn)["request_method_list"]}
            methods = sorted(declared if methods is None else declared & set(methods))
        elif code is None or not code.co_filename.startswith(FRAMEWORK_DIRS):
            findings.append(Finding(_wrapper_name(fn), "method", _wrapper_name(fn)))
        fn = wrapped
    return findings, methods, fn


def _wrapper_name(fn: Any) -> str:
    """functools.wraps gives a wrapper the view's name; its code still names the decorator."""
    code = getattr(fn, "__code__", None)
    if code is None:
        return _dotted(fn)
    module = getattr(fn, "__globals__", {}).get("__name__", fn.__module__)
    return f"{module}.{getattr(code, 'co_qualname', code.co_name)}"


def _user_passes_test(test: Any) -> Finding:
    code = getattr(test, "__code__", None)
    if code is LOGIN_TEST:
        return Finding(
            "django.contrib.auth.decorators.login_required", "method", "login_required"
        )
    perms = _closure(test).get("perms") if code is PERMISSION_TEST else None
    if perms is not None:
        return Finding(
            "django.contrib.auth.decorators.permission_required",
            "method",
            ", ".join(perms),
        )
    return Finding(_dotted(test), "method", _dotted(test))


def _drf(view: Any, cls: Any, root: Path) -> list[tuple[str, str, list[Finding]]]:
    actions = getattr(view, "actions", None)
    initkwargs = getattr(view, "initkwargs", {})
    if actions is not None:
        actions = (
            {**actions, "head": actions["get"]}
            if "get" in actions and "head" not in actions
            else actions
        )
        served = {*actions, "options"}
    else:
        served = {
            m
            for m in cls.http_method_names
            if hasattr(cls, m) or (m == "head" and hasattr(cls, "get"))
        }
    func = _api_view_function(cls)
    layer = drf_layer(
        overrides_get_permissions=_project_defines(cls, "get_permissions"),
        action_kwargs="permission_classes" in initkwargs,
        class_attribute=hasattr(func, "permission_classes")
        if func
        else _project_defines(cls, "permission_classes"),
        setting="DEFAULT_PERMISSION_CLASSES" in getattr(settings, "REST_FRAMEWORK", {}),
    )
    handler = _handler(func or cls, root)
    methods = sorted(m.upper() for m in served if m in cls.http_method_names)
    return [
        (m, handler, _drf_permissions(cls, initkwargs, actions, m, layer))
        for m in methods
    ]


def _drf_permissions(
    cls: Any, initkwargs: dict[str, Any], actions: Any, method: str, layer: str
) -> list[Finding]:
    view = cls(**initkwargs)
    if actions is not None:
        view.action_map = actions
    view.args, view.kwargs, view.format_kwarg = (), {}, None
    try:
        view.request = view.initialize_request(RequestFactory().generic(method, "/"))
        permissions = view.get_permissions()
    except Exception as exc:
        name = _dotted(cls.get_permissions)
        raised = f"get_permissions() raised {type(exc).__name__}"
        reason = f"{raised} without a real request; its permissions are not readable"
        return [Finding(name, layer, raised, reason)]
    if not permissions:
        return [Finding(NO_CHECK, layer, None)]
    return [Finding(_dotted(type(p)), layer, type(p).__name__) for p in permissions]


def _api_view_function(cls: type) -> Any:
    """@api_view builds a WrappedAPIView whose handlers close over the decorated function."""
    if cls.__qualname__ != "WrappedAPIView":  # its __name__ is the function's
        return None
    return next(
        (_closure(v)["func"] for v in vars(cls).values() if "func" in _closure(v)), None
    )


def _cbv(view_class: Any) -> list[tuple[str, list[Finding]]]:
    own = _mixins(view_class)
    dispatch = _decorated_method(view_class, "dispatch")
    served = [
        m
        for m in view_class.http_method_names
        if hasattr(view_class, m) or (m == "head" and hasattr(view_class, "get"))
    ]
    result = []
    for m in served:
        decorated = [
            f for f in (dispatch, _decorated_method(view_class, m)) if f is not None
        ]
        findings = [*own, *decorated] or [Finding(NO_CHECK, "framework-default", None)]
        result.append((m.upper(), findings))
    return result


def _mixins(view_class: Any) -> list[Finding]:
    mro = view_class.__mro__
    findings = []
    if mixins.LoginRequiredMixin in mro:
        findings.append(
            Finding(_dotted(mixins.LoginRequiredMixin), "class", "LoginRequiredMixin")
        )
    if mixins.PermissionRequiredMixin in mro:
        if _project_defines(view_class, "has_permission") or _project_defines(
            view_class, "get_permission_required"
        ):
            findings.append(
                Finding(
                    _dotted(view_class), "class", "PermissionRequiredMixin (overridden)"
                )
            )
        elif view_class.permission_required is None:
            findings.append(
                Finding(
                    _dotted(view_class),
                    "class",
                    "PermissionRequiredMixin",
                    "permission_required is not set; Django raises ImproperlyConfigured",
                )
            )
        else:
            required = view_class.permission_required
            raw = required if isinstance(required, str) else ", ".join(required)
            findings.append(
                Finding(_dotted(mixins.PermissionRequiredMixin), "class", raw)
            )
    if mixins.UserPassesTestMixin in mro:
        test = view_class.test_func
        findings.append(Finding(_dotted(test), "class", _dotted(test)))
    return findings


def _decorated_method(view_class: type, name: str) -> Finding | None:
    """A method_decorator hides its decorators until call time, so a decorated method is unknown."""
    method = getattr(view_class, name, None)
    if (
        method is None
        or not hasattr(method, "__wrapped__")
        or not _project_defines(view_class, name)
    ):
        return None
    return Finding(_dotted(method), "method", f"decorated {name}")


def _project_defines(cls: type, attribute: str) -> bool:
    owner = next((c for c in cls.__mro__ if attribute in vars(c)), None)
    return owner is not None and not owner.__module__.startswith(FRAMEWORK_MODULES)


def _handler(obj: Any, root: Path) -> str:
    """Project code → relative/path.py:line; framework or installed code → dotted name."""
    target = getattr(obj, "__func__", obj)
    try:
        file = Path(inspect.getsourcefile(target) or "").resolve()
        line = inspect.getsourcelines(target)[1]
    except (OSError, TypeError):
        return _dotted(target)
    installed = {
        Path(p).resolve() for p in (sys.prefix, sys.base_prefix, sys.exec_prefix)
    }
    if file.is_relative_to(root) and not any(file.is_relative_to(p) for p in installed):
        return f"{file.relative_to(root).as_posix()}:{line}"
    return _dotted(target)


def _dotted(obj: Any) -> str:
    module = getattr(obj, "__module__", None) or type(obj).__module__
    name = getattr(obj, "__qualname__", None) or type(obj).__qualname__
    return f"{module}.{name}"
