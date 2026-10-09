"""The pinned Boot Environment: settings module, stubs and pinned settings, each with its reason."""

from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from unittest import mock

from access_inspector import inventory

ROOT = (
    Path(__file__).resolve().parents[2]
)  # tools/access-inspector/ sits two levels under the project root


@dataclass(frozen=True)
class Env:
    name: str  # environment variable, set before the settings load and overriding the shell
    value: str
    reason: str


@dataclass(frozen=True)
class Stub:
    target: (
        str  # dotted name patched before the settings load, e.g. "config.secrets.load"
    )
    reason: str
    replacement: Any = None  # None → MagicMock


@dataclass(frozen=True)
class Pin:
    setting: str
    value: Any
    reason: str


class BootError(Exception):
    pass


# --- project ---
ENTRY: str | None = "config.settings"

ENVIRON: list[Env] = [
    Env("SHOP_ENV", "production", reason="production value; mounts no dev-only routes"),
]

STUBS: list[Stub] = [
    Stub(
        "config.secrets.load",
        reason="secrets vault client is only installed in production",
        replacement=lambda: {"SECRET_KEY": "inventory-stub"},
    ),
]

PINNED: list[Pin] = [
    Pin("DEBUG", False, reason="production value; settings default to True"),
]
# --- end project ---


def check_config(
    entry: str, stubs: list[Stub], pinned: list[Pin], environ: list[Env]
) -> None:
    for env in environ:
        if env.name == "DJANGO_SETTINGS_MODULE":
            raise BootError("set the settings module with ENTRY, not ENVIRON")
        if not isinstance(env.value, str):
            raise BootError(f"environment variable {env.name} value must be a string")
        if not env.reason:
            raise BootError(f"environment variable {env.name} needs a reason")
    guarded = ["django.conf.settings", entry]
    package = entry.rpartition(".")[0]
    if package.rpartition(".")[2] == "settings":  # config/settings/{base,production}.py
        guarded.append(package)
    for stub in stubs:
        if any(stub.target == g or stub.target.startswith(g + ".") for g in guarded):
            raise BootError("settings module may not be stubbed")
        if not stub.reason:
            raise BootError(f"stub {stub.target} needs a reason")
    for pin in pinned:
        if pin.setting == "DEBUG" and pin.value is not False:
            raise BootError("pin must move toward production")
        if not pin.reason:
            raise BootError(f"pin {pin.setting} needs a reason")
        try:
            json.dumps(pin.value)
        except TypeError:
            raise BootError(
                f"pin {pin.setting} value is not JSON-serialisable"
            ) from None


def default_entry(root: Path) -> str:
    manage = root / "manage.py"
    found = re.search(
        r"""setdefault\(\s*["']DJANGO_SETTINGS_MODULE["']\s*,\s*["']([\w.]+)["']""",
        manage.read_text(encoding="utf-8") if manage.is_file() else "",
    )
    if found is None:
        raise BootError(
            f"ENTRY is not set and {manage} sets no DJANGO_SETTINGS_MODULE default"
        )
    return found.group(1)


def boot() -> inventory.BootEnvironment:
    entry = ENTRY or default_entry(ROOT)
    check_config(entry, STUBS, PINNED, ENVIRON)
    sys.path.insert(0, str(ROOT))
    os.environ["DJANGO_SETTINGS_MODULE"] = entry
    os.environ.update({env.name: env.value for env in ENVIRON})
    try:
        for stub in STUBS:
            replacement = (
                mock.MagicMock() if stub.replacement is None else stub.replacement
            )
            mock.patch(stub.target, replacement).start()
        import django
        from django.conf import settings

        for pin in PINNED:
            setattr(settings, pin.setting, pin.value)
        django.setup()
        from django.urls import get_resolver

        get_resolver().url_patterns  # imports the URLconf: a broken one is a boot error
    except Exception as exc:
        raise BootError(
            f"cannot boot settings module {entry}: {type(exc).__name__}: {exc}"
        ) from exc
    return inventory.BootEnvironment(
        entry=entry,
        environ=[inventory.Env(e.name, e.value, e.reason) for e in ENVIRON],
        stubs=[inventory.Stub(s.target, s.reason) for s in STUBS],
        pinned=[inventory.Pin(p.setting, p.value, p.reason) for p in PINNED],
    )
