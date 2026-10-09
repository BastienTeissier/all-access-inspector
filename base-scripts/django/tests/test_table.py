import json
from pathlib import Path

from access_inspector.inventory import from_dict
from access_inspector.table import render

SAMPLE = Path(__file__).resolve().parents[3] / "schema" / "samples" / "canonical.json"


def test_table_marks_unknowns_and_layers() -> None:
    lines = render(
        from_dict(json.loads(SAMPLE.read_text(encoding="utf-8")))
    ).splitlines()
    assert lines[0].split() == [
        "METHOD",
        "PATH",
        "AUTHENTICATION",
        "AUTHORIZATION",
        "HANDLER",
        "DIMENSIONS",
    ]
    assert len(lines) == 8
    report = next(line for line in lines if "/api/reports/{slug}" in line)
    assert report.startswith("?")
    assert report.split()[3:5] == ["required@global", "unknown@method"]
