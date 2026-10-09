from pathlib import Path

import pytest

from access_inspector.boot import (
    BootError,
    Env,
    Pin,
    Stub,
    check_config,
    default_entry,
)

ENTRY = "config.settings.production"


@pytest.mark.parametrize(
    "target",
    [
        ENTRY,
        f"{ENTRY}.SECRET_KEY",
        "django.conf.settings",
        "config.settings.base.ALLOWED_HOSTS",
    ],
)
def test_boot_stub_rules_settings_module(target: str) -> None:
    with pytest.raises(BootError, match="settings module may not be stubbed"):
        check_config(ENTRY, [Stub(target, reason="vault")], [], [])


def test_boot_stub_rules_toward_production() -> None:
    with pytest.raises(BootError, match="pin must move toward production"):
        check_config(ENTRY, [], [Pin("DEBUG", True, reason="local")], [])


def test_boot_stub_rules_reasons() -> None:
    with pytest.raises(BootError, match="stub config.secrets.load needs a reason"):
        check_config(ENTRY, [Stub("config.secrets.load", reason="")], [], [])
    with pytest.raises(BootError, match="pin ALLOWED_HOSTS needs a reason"):
        check_config(
            ENTRY, [], [Pin("ALLOWED_HOSTS", ["shop.example.com"], reason="")], []
        )
    with pytest.raises(BootError, match="pin START value is not JSON-serialisable"):
        check_config(ENTRY, [], [Pin("START", object(), reason="frozen clock")], [])
    check_config(
        ENTRY,
        [Stub("config.secrets.load", reason="vault")],
        [Pin("DEBUG", False, reason="production")],
        [Env("DJANGO_ENV", "production", reason="production value")],
    )


@pytest.mark.parametrize(
    ("env", "message"),
    [
        (
            Env("DJANGO_SETTINGS_MODULE", "config.settings.dev", reason="dev"),
            "set the settings module with ENTRY, not ENVIRON",
        ),
        (
            Env("WORKERS", 4, reason="production value"),  # type: ignore[arg-type]
            "environment variable WORKERS value must be a string",
        ),
        (
            Env("DJANGO_ENV", "production", reason=""),
            "environment variable DJANGO_ENV needs a reason",
        ),
        (Env("", "x", reason="r"), "environment variable name '' is not valid"),
        (Env("A=B", "x", reason="r"), "environment variable name 'A=B' is not valid"),
    ],
)
def test_boot_environ_rules(env: Env, message: str) -> None:
    with pytest.raises(BootError, match=message):
        check_config(ENTRY, [], [], [env])


def test_boot_environ_rejects_a_name_set_twice() -> None:
    twice = [Env("DJANGO_ENV", "production", reason="r")] * 2
    with pytest.raises(BootError, match="environment variable DJANGO_ENV is set twice"):
        check_config(ENTRY, [], [], twice)


def test_boot_default_entry(tmp_path: Path) -> None:
    (tmp_path / "manage.py").write_text(
        'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")\n'
    )
    assert default_entry(tmp_path) == "config.settings.dev"


def test_boot_default_entry_missing(tmp_path: Path) -> None:
    with pytest.raises(BootError, match="ENTRY is not set"):
        default_entry(tmp_path)
