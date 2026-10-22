"""Walk the URL resolver of the booted project; every mounted pattern becomes a RawEndpoint, none is dropped."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from django.conf import settings
from django.urls import URLPattern, URLResolver, get_resolver
from django.urls.resolvers import LocalePrefixPattern, RoutePattern
from django.utils import translation

from access_inspector.paths import Part, normalize


@dataclass(frozen=True)
class RawEndpoint:
    callback: Any
    path: str
    reason: str | None = None  # set when the pattern object itself is not understood


def endpoints() -> list[RawEndpoint]:
    with translation.override(settings.LANGUAGE_CODE):
        return _walk(get_resolver().url_patterns, [])


def _walk(patterns: list[Any], parts: list[Part]) -> list[RawEndpoint]:
    found: list[RawEndpoint] = []
    for pattern in patterns:
        if isinstance(pattern, URLPattern):
            found.append(
                RawEndpoint(
                    pattern.callback, normalize([*parts, _part(pattern.pattern)])
                )
            )
        elif isinstance(pattern, URLResolver) and isinstance(
            pattern.pattern, LocalePrefixPattern
        ):
            for language, _ in settings.LANGUAGES:
                with translation.override(language):
                    prefix = Part("route", pattern.pattern.language_prefix)
                    found += _walk(pattern.url_patterns, [*parts, prefix])
        elif isinstance(pattern, URLResolver):
            found += _walk(pattern.url_patterns, [*parts, _part(pattern.pattern)])
        else:
            kind = f"{type(pattern).__module__}.{type(pattern).__qualname__}"
            found.append(
                RawEndpoint(
                    pattern, normalize(parts), f"unrecognised urlpattern object {kind}"
                )
            )
    return found


def _part(pattern: Any) -> Part:
    return Part("route" if isinstance(pattern, RoutePattern) else "regex", str(pattern))
