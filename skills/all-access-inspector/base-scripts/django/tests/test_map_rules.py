import inspect
import json
import re
import sys
import textwrap
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from access_map import project
from access_map.runtime import MapRuleError, check, line_of, to_canonical_json

RULES = ("roles", "includes", "staff", "grants", "scopes", "scoped", "capabilities")
SAMPLE = {
    "shop/__init__.py": "",
    "shop/roles.py": 'GROUP_PERMISSIONS = {\n    "clerk": ["shop.view_order"],\n'
    '    "manager": ["shop.change_order"],\n}\n',
    "shop/admin.py": "def get_queryset(self, request):\n"
    "    return super().get_queryset(request).filter(owner=request.user)\n",
    "shop/views.py": "\n\ndef export_orders(request):\n    pass\n",
    "core/adapter.py": "def save_user(user):\n    user.is_staff = True\n"
    '    user.groups.add(Group.objects.get(name="user"))\n',
    "core/querysets.py": "def visible(request, qs):\n"
    "    return qs.filter(subsidiary=request.user.subsidiary)\n",
}


@pytest.fixture
def sample(tmp_path: Path) -> Iterator[Path]:
    for rel, text in SAMPLE.items():
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_text(text, encoding="utf-8")
    sys.path.insert(0, str(tmp_path))
    yield tmp_path
    sys.path.remove(str(tmp_path))
    sys.modules.pop("shop.roles", None)
    sys.modules.pop("shop", None)


def example(rule: str) -> str:
    """The commented example of one Map Rule, as the body of that rule."""
    doc = inspect.getdoc(getattr(project, rule)) or ""
    body = textwrap.dedent(doc.split(":\n", 1)[1])
    return f"def {rule}():\n" + textwrap.indent(body, "    ")


def test_map_rules_ship_empty() -> None:
    assert all(getattr(project, rule)() == [] for rule in RULES)


def test_map_rule_examples_return_facts_with_at(sample: Path) -> None:
    namespace: dict[str, Any] = {"ROOT": sample, "line_of": line_of}
    for rule in RULES:
        exec(example(rule), namespace)
    for rule in RULES:
        found = namespace[rule]()
        assert found, rule
        assert all(re.fullmatch(r"[^\s:]+:\d+", fact["at"]) for fact in found), rule
    assert namespace["roles"]() == [
        {"id": "clerk", "kind": "group", "at": "shop/roles.py:2"},
        {"id": "manager", "kind": "group", "at": "shop/roles.py:3"},
    ]
    assert namespace["staff"]() == [{"role": "user", "at": "core/adapter.py:2"}]


def test_line_of_names_the_missing_text(tmp_path: Path) -> None:
    (tmp_path / "a.py").write_text("x = 1\n", encoding="utf-8")
    assert line_of(tmp_path, "a.py", "x = 1") == "a.py:1"
    with pytest.raises(MapRuleError, match="a.py: no line contains 'y = 2'"):
        line_of(tmp_path, "a.py", "y = 2")


def runtime(**more: Any) -> dict[str, Any]:
    endpoint = {"method": "GET", "path": "/b/", "handler": "h", "layers": []}
    return {
        "schema_version": "1",
        "stack": "django",
        "base_script": {"stack": "django", "version": "0.4.0"},
        "about": {"reads": "r", "holds": [], "heuristics": [], "command": "c"},
        "roles": [
            {"id": "manager", "kind": "group", "at": "r.py:3"},
            {"id": "clerk", "kind": "group", "at": "r.py:2"},
        ],
        "grants": {
            "shop.view": [
                {"role": "manager", "at": "r.py:3"},
                {"role": "clerk", "at": "r.py:2"},
            ]
        },
        "scopes": [],
        "scoped": [],
        "capabilities": [],
        "endpoints": [endpoint, {**endpoint, "path": "/a/"}],
        "snippets": {"z.py:1": "z", "a.py:1": "a"},
        **more,
    }


def test_runtime_serialisation_is_sorted_and_stable() -> None:
    text = to_canonical_json(runtime())
    assert text.endswith("}\n")
    data = json.loads(text)
    assert list(data) == list(runtime())
    assert [r["id"] for r in data["roles"]] == ["clerk", "manager"]
    assert [e["path"] for e in data["endpoints"]] == ["/a/", "/b/"]
    assert [h["role"] for h in data["grants"]["shop.view"]] == ["clerk", "manager"]
    assert list(data["snippets"]) == ["a.py:1", "z.py:1"]
    assert '    {"id": "clerk", "kind": "group", "at": "r.py:2"},\n' in text
    assert '  "scopes": [],\n' in text
    assert to_canonical_json(json.loads(text)) == text


def test_runtime_check() -> None:
    committed = runtime()
    assert check(committed, runtime()) == []
    current = runtime(
        roles=[{"id": "clerk", "kind": "group", "at": "r.py:4"}],
        grants={},
        stack="other",
    )
    assert check(committed, current) == [
        '~ stack: "django" -> "other"',
        '~ roles clerk: {"id": "clerk", "kind": "group", "at": "r.py:2"}'
        ' -> {"id": "clerk", "kind": "group", "at": "r.py:4"}',
        "- roles manager",
        "- grants shop.view",
    ]
    added = runtime(
        scopes=[{"id": "own", "label": "Own", "at": "q.py:1", "basis": "inferred"}]
    )
    assert check(committed, added) == [
        '+ scopes own: {"id": "own", "label": "Own", "at": "q.py:1", "basis": "inferred"}'
    ]
