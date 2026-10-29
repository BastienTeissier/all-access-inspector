"""Golden-file tests: run the vendored Map Introspect inside a copy of this fixture."""

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
BASE = SKILL / "base-scripts" / "django" / "access_map"
EXPECTED = FIXTURE / "expected" / "runtime.json"
INVENTORY = FIXTURE / "expected" / "inventory.json"
PROJECT_SECTION = re.compile(r"# --- project ---\n.*?# --- end project ---\n", re.S)


@pytest.fixture
def project(tmp_path: Path) -> Path:
    copy = tmp_path / "django-demo"
    shutil.copytree(
        FIXTURE,
        copy,
        ignore=shutil.ignore_patterns(".venv", "__pycache__", ".pytest_cache", "tests"),
    )
    shutil.copyfile(INVENTORY, copy / "tools" / "access-inspector" / "inventory.json")
    return copy


def run(
    project: Path, *args: str, cwd: Path | None = None
) -> subprocess.CompletedProcess[str]:
    script = project / "tools" / "access-map" / "introspect.py"
    return subprocess.run(
        [sys.executable, str(script), *args],
        cwd=cwd or project,
        env=dict(os.environ),
        capture_output=True,
        text=True,
        check=False,
    )


def output(project: Path) -> Path:
    return project / "tools" / "access-map" / "runtime.json"


def test_map_golden(project: Path) -> None:
    output(project).unlink()
    result = run(project)
    assert result.returncode == 0, result.stderr
    assert output(project).read_bytes() == EXPECTED.read_bytes()


def test_map_golden_is_schema_valid() -> None:
    schema = json.loads(
        (SKILL / "schema" / "runtime.schema.json").read_text(encoding="utf-8")
    )
    jsonschema.Draft202012Validator(schema).validate(
        json.loads(EXPECTED.read_text(encoding="utf-8"))
    )


def test_map_determinism(project: Path, tmp_path: Path) -> None:
    assert run(project).returncode == 0
    first = output(project).read_bytes()
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    assert run(project, cwd=elsewhere).returncode == 0
    assert output(project).read_bytes() == first


def test_map_check_clean(project: Path) -> None:
    result = run(project, "--check")
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout == "runtime up to date\n"


def test_map_check_removed_grant(project: Path) -> None:
    roles = project / "shop" / "roles.py"
    text = roles.read_text(encoding="utf-8")
    assert '"shop.delete_order",' in text
    roles.write_text(re.sub(r'\s*"shop\.delete_order",', "", text), encoding="utf-8")
    result = run(project, "--check")
    assert result.returncode == 1, result.stderr
    assert "- grants shop.delete_order" in result.stdout
    assert "run `python tools/access-map/introspect.py`" in result.stdout
    assert output(project).read_bytes() == EXPECTED.read_bytes()


def test_map_boot_failure(project: Path) -> None:
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
    assert output(project).read_bytes() == EXPECTED.read_bytes()


def test_map_vendored_copy_matches_base_script() -> None:
    vendored = FIXTURE / "tools" / "access-map"
    names = sorted(p.name for p in BASE.glob("*.py") if p.name != "__init__.py")
    assert sorted(p.name for p in vendored.glob("*.py")) == names
    for name in names:
        base = PROJECT_SECTION.sub("", (BASE / name).read_text(encoding="utf-8"))
        assert (
            PROJECT_SECTION.sub("", (vendored / name).read_text(encoding="utf-8"))
            == base
        ), name
