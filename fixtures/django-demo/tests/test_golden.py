"""Golden-file tests: run the vendored Adapted Script inside a copy of this fixture."""

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import jsonschema
import pytest

FIXTURE = Path(__file__).resolve().parents[1]
REPO = FIXTURE.parents[1]
SKILL = REPO / "skills" / "all-access-inspector"
BASE_SCRIPT = SKILL / "base-scripts" / "django" / "access_inspector"
EXPECTED = FIXTURE / "expected" / "inventory.json"
PROJECT_SECTION = re.compile(r"# --- project ---\n.*?# --- end project ---\n", re.S)


@pytest.fixture
def project(tmp_path: Path) -> Path:
    copy = tmp_path / "django-demo"
    shutil.copytree(
        FIXTURE,
        copy,
        ignore=shutil.ignore_patterns(".venv", "__pycache__", ".pytest_cache", "tests"),
    )
    return copy


def run(
    project: Path,
    *args: str,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    script = project / "tools" / "access-inspector" / "inspect.py"
    return subprocess.run(
        [sys.executable, str(script), *args],
        cwd=cwd or project,
        env={**os.environ, **(env or {})},
        capture_output=True,
        text=True,
        check=False,
    )


def output(project: Path) -> Path:
    return project / "tools" / "access-inspector" / "inventory.json"


def edit(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    assert old in text
    path.write_text(text.replace(old, new), encoding="utf-8")


def test_django_golden(project: Path) -> None:
    result = run(project)
    assert result.returncode == 0, result.stderr
    assert output(project).read_bytes() == EXPECTED.read_bytes()


def test_django_golden_is_schema_valid() -> None:
    schema = json.loads(
        (SKILL / "schema" / "inventory.schema.json").read_text(encoding="utf-8")
    )
    jsonschema.Draft202012Validator(schema).validate(
        json.loads(EXPECTED.read_text(encoding="utf-8"))
    )


def test_django_builtins_exercised() -> None:
    endpoints = json.loads(EXPECTED.read_text(encoding="utf-8"))["endpoints"]
    rules = {
        e[axis]["rule"]
        for e in endpoints
        for axis in ("authentication", "authorization")
    }
    builtins = {
        "AllowAny",
        "IsAuthenticated",
        "IsAuthenticatedOrReadOnly",
        "IsAdminUser",
        "DjangoModelPermissions",
        "login_required",
        "permission_required",
        "LoginRequiredMixin",
        "PermissionRequiredMixin",
        "django_admin",
        "no_check",
    }
    assert {f"builtin:{name}" for name in builtins} | {
        "recognition:tenant_middleware"
    } <= rules


def test_django_unknowns_output(project: Path) -> None:
    result = run(project, "--unknowns")
    assert result.returncode == 0, result.stderr
    unknowns = [json.loads(line) for line in result.stdout.splitlines()]
    support = [e for e in unknowns if e["path"].startswith("/admin/support/")]
    assert len(support) == 8  # every admin_view() route; login stays unchecked
    assert [(e["method"], e["path"]) for e in unknowns[len(support) :]] == [
        ("GET", "/api/orders/{pk}/"),
        ("HEAD", "/api/orders/{pk}/"),
        ("OPTIONS", "/api/orders/{pk}/"),
        ("GET", "/api/receipts/{pk}/"),
        ("HEAD", "/api/receipts/{pk}/"),
        ("OPTIONS", "/api/receipts/{pk}/"),
        ("ANY", "/graphql/"),
        ("ANY", "/hooks/ping"),
        ("GET", "/pages/archive/"),
        ("HEAD", "/pages/archive/"),
        ("OPTIONS", "/pages/archive/"),
        ("ANY", "/pages/doc/{id}/"),
    ]
    assert all(e["unknown_reason"] for e in unknowns)
    assert not output(project).exists()


def test_django_table_no_write(project: Path) -> None:
    shutil.copyfile(EXPECTED, output(project))
    before = output(project).stat().st_mtime_ns
    result = run(project, "--table")
    assert result.returncode == 0, result.stderr
    endpoints = json.loads(EXPECTED.read_text(encoding="utf-8"))["endpoints"]
    assert len(result.stdout.splitlines()) == len(endpoints) + 1
    assert "/graphql/" in result.stdout
    assert output(project).stat().st_mtime_ns == before
    assert output(project).read_bytes() == EXPECTED.read_bytes()


def test_django_determinism(project: Path, tmp_path: Path) -> None:
    assert run(project).returncode == 0
    first = output(project).read_bytes()
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    assert run(project, cwd=elsewhere).returncode == 0
    assert output(project).read_bytes() == first


def test_django_environ_overrides_the_shell(project: Path) -> None:
    result = run(project, env={"SHOP_ENV": "local"})
    assert result.returncode == 0, result.stderr
    assert output(project).read_bytes() == EXPECTED.read_bytes()


def test_django_environ_shapes_the_route_table(project: Path) -> None:
    edit(
        project / "tools" / "access-inspector" / "boot.py",
        'Env("SHOP_ENV", "production"',
        'Env("SHOP_ENV", "local"',
    )
    result = run(
        project, "--table"
    )  # the dev-only route is mounted, and no dimension covers it
    assert result.returncode == 2
    assert "ANY /dev/mail-preview/" in result.stderr
    assert "/dev/mail-preview/" not in EXPECTED.read_text(encoding="utf-8")


def test_django_boot_failure(project: Path) -> None:
    boot = project / "tools" / "access-inspector" / "boot.py"
    text = boot.read_text(encoding="utf-8")
    boot.write_text(
        re.sub(
            r"STUBS: list\[Stub\] = \[\n.*?\n\]\n",
            "STUBS: list[Stub] = []\n",
            text,
            flags=re.S,
        )
    )
    result = run(project)
    assert result.returncode == 2
    assert "No module named 'vault_client'" in result.stderr
    assert "config.settings" in result.stderr
    assert not output(project).exists()


def test_django_urlconf_failure(project: Path) -> None:
    edit(
        project / "config" / "urls.py",
        'include("shop.urls")',
        'include("shop.missing_urls")',
    )
    result = run(project)
    assert result.returncode == 2
    assert "No module named 'shop.missing_urls'" in result.stderr
    assert "config.settings" in result.stderr
    assert not output(project).exists()


def test_django_check_clean(project: Path) -> None:
    committed = json.loads(EXPECTED.read_text(encoding="utf-8"))
    committed["endpoints"].reverse()
    output(project).write_text(json.dumps(committed, indent=4), encoding="utf-8")
    before = output(project).read_bytes()
    result = run(project, "--check")
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout == "inventory up to date\n"
    assert output(project).read_bytes() == before


def test_django_check_drift(project: Path) -> None:
    shutil.copyfile(EXPECTED, output(project))
    edit(
        project / "shop" / "api.py",
        'methods=["post"], permission_classes=[IsAdminUser]',
        'methods=["post"], permission_classes=[AllowAny]',
    )
    result = run(project, "--check")
    assert result.returncode == 1, result.stderr
    refund = "POST /api/orders/{pk}/refund/ (shop/api.py:24)"
    assert f"~ {refund} authorization.value: rule -> none" in result.stdout
    assert (
        f"~ {refund} authorization.rule: builtin:IsAdminUser -> recognition:tenant_middleware"
        in result.stdout
    )  # on a tie the check a request meets first is reported
    assert f"~ {refund} authentication.value" not in result.stdout  # tenant rule
    assert "run `python tools/access-inspector/inspect.py`" in result.stdout
    assert output(project).read_bytes() == EXPECTED.read_bytes()


def test_django_check_missing_inventory(project: Path) -> None:
    result = run(project, "--check")
    assert result.returncode == 2
    assert "tools/access-inspector/inventory.json not found" in result.stderr
    assert "generate it first" in result.stderr
    assert not output(project).exists()


def test_django_check_unreadable_inventory(project: Path) -> None:
    output(project).write_text("<<<<<<< HEAD\n", encoding="utf-8")
    result = run(project, "--check")
    assert result.returncode == 2
    assert "cannot read tools/access-inspector/inventory.json" in result.stderr
    assert output(project).read_text(encoding="utf-8") == "<<<<<<< HEAD\n"


def test_django_check_missing_dimension(project: Path) -> None:
    edit(
        project / "config" / "urls.py",
        '    path("health/", views.health),',
        '    path("orphan/", views.health),',
    )
    result = run(project)
    assert result.returncode == 2
    assert (
        "ANY /orphan/ (shop/views.py:13): no rule assigns dimension 'access_tier'"
        in result.stderr
    )
    assert not output(project).exists()


def test_django_vendored_copy_matches_base_script() -> None:
    vendored = FIXTURE / "tools" / "access-inspector"
    names = sorted(p.name for p in BASE_SCRIPT.glob("*.py") if p.name != "__init__.py")
    assert sorted(p.name for p in vendored.glob("*.py")) == names
    for name in names:
        base = PROJECT_SECTION.sub("", (BASE_SCRIPT / name).read_text(encoding="utf-8"))
        assert (
            PROJECT_SECTION.sub("", (vendored / name).read_text(encoding="utf-8"))
            == base
        ), name
    assert (vendored / "VERSION").read_text() == (BASE_SCRIPT / "VERSION").read_text()
