"""Turn Django URL pattern parts into the inventory path format: leading /, params as {name}."""

from __future__ import annotations

import re
from typing import Literal, NamedTuple

ROUTE_PARAM = re.compile(r"<(?:[^>:]+:)?(\w+)>")
LITERAL_ESCAPES = set(r"./-_~:@!$&'*+,;=%")


class Part(NamedTuple):
    kind: Literal["route", "regex"]
    text: str


def normalize(parts: list[Part]) -> str:
    path = "".join(
        _route(p.text) if p.kind == "route" else _regex(p.text) for p in parts
    )
    return path if path.startswith("/") else "/" + path


def _route(text: str) -> str:
    return ROUTE_PARAM.sub(lambda m: "{" + m.group(1) + "}", text)


def _regex(text: str) -> str:
    if text.startswith("^"):
        text = text[1:]
    for anchor in ("\\Z", "$"):
        if text.endswith(anchor) and not text.endswith("\\" + anchor):
            text = text[: -len(anchor)]
            break
    out: list[str] = []
    i = 0
    while i < len(text):
        char = text[i]
        if char == "\\" and i + 1 < len(text):
            following = text[i + 1]
            out.append(following if following in LITERAL_ESCAPES else char + following)
            i += 2
        elif char == "(":
            end = _group_end(text, i)
            group = text[i:end]
            name = re.match(r"\(\?P<(\w+)>", group)
            if name or not group.startswith("(?"):  # capturing group
                out.append("{" + (name.group(1) if name else "param") + "}")
            elif group.startswith("(?:"):  # non-capturing: its content is literal path
                out.append(_regex(group[3:-1]))
            # lookarounds and inline flags match no characters
            i = _skip_quantifier(text, end)
        else:
            out.append(char)
            i += 1
    return "".join(out)


def _group_end(text: str, start: int) -> int:
    """Index just past the parenthesis closing the group opened at start."""
    depth = 0
    in_class = False
    i = start
    while i < len(text):
        char = text[i]
        if char == "\\":
            i += 2
            continue
        if in_class:
            in_class = char != "]"
        elif char == "[":
            in_class = True
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return len(text)


def _skip_quantifier(text: str, i: int) -> int:
    if i < len(text) and text[i] in "?*+":
        return i + 1
    if i < len(text) and text[i] == "{":
        end = text.find("}", i)
        return end + 1 if end != -1 else i
    return i
