import pytest

from access_inspector.paths import Part, normalize


@pytest.mark.parametrize(
    ("parts", "expected"),
    [
        pytest.param([Part("route", "api/<int:pk>/")], "/api/{pk}/", id="converter"),
        pytest.param([Part("route", "api/<slug>")], "/api/{slug}", id="bare-param"),
        pytest.param(
            [Part("regex", r"^items/(?P<slug>[\w-]+)$")],
            "/items/{slug}",
            id="named-group",
        ),
        pytest.param(
            [Part("regex", r"^items/([0-9]{4})/$")],
            "/items/{param}/",
            id="unnamed-group",
        ),
        pytest.param(
            [Part("regex", r"^a/(?P<x>[(]+)/b$")], "/a/{x}/b", id="paren-in-char-class"
        ),
        pytest.param([Part("regex", r"^(?P<url>.*)$")], "/{url}", id="catch-all"),
        pytest.param(
            [Part("regex", r"^feed\.xml$")], "/feed.xml", id="escaped-literal"
        ),
        pytest.param(
            [Part("regex", r"^page/(?P<n>\d+)?/$")], "/page/{n}/", id="quantified-group"
        ),
        pytest.param(
            [
                Part("route", "fr/"),
                Part("route", "api/"),
                Part("regex", r"^orders/(?P<pk>\d+)/$"),
            ],
            "/fr/api/orders/{pk}/",
            id="nested-prefixes",
        ),
        pytest.param([Part("route", "ping")], "/ping", id="no-trailing-slash-kept"),
        pytest.param(
            [Part("regex", r"^pages/(?:v1/)?old/$")],
            "/pages/v1/old/",
            id="non-capturing-group",
        ),
        pytest.param(
            [Part("regex", r"^(?i)docs/(?!draft)(?P<slug>\w+)/$")],
            "/docs/{slug}/",
            id="lookahead-and-flags",
        ),
        pytest.param([Part("route", "")], "/", id="root"),
        pytest.param(
            [Part("route", "/already")], "/already", id="leading-slash-not-doubled"
        ),
    ],
)
def test_paths_normalize(parts: list[Part], expected: str) -> None:
    assert normalize(parts) == expected
