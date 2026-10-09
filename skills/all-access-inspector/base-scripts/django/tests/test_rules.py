from pathlib import Path

import pytest

from access_inspector.inventory import Axis
from access_inspector.rules import (
    Ack,
    Finding,
    Rule,
    RuleError,
    check_rules,
    drf_layer,
    global_findings,
    methods,
    resolve,
)

IS_AUTHENTICATED = Finding(
    "rest_framework.permissions.IsAuthenticated", "class", "IsAuthenticated"
)
IS_OWNER = Finding("shop.permissions.IsOwner", "class", "IsOwner")
READ_ONLY = Finding(
    "rest_framework.permissions.IsAuthenticatedOrReadOnly",
    "class",
    "IsAuthenticatedOrReadOnly",
)
NO_CHECK = Finding("no_check", "framework-default", None)
TENANT = Rule(
    "tenant",
    "config/middleware.py:2",
    "required",
    "none",
    path_prefix="/api/",
    layer="global",
    raw="Tenant",
)


@pytest.mark.parametrize(
    ("flags", "layer"),
    [
        pytest.param(
            (True, False, True, True), "method", id="get_permissions-override"
        ),
        pytest.param((False, True, True, True), "method", id="action-kwargs"),
        pytest.param((False, False, True, True), "class", id="class-attribute"),
        pytest.param(
            (False, False, False, True), "global", id="rest-framework-setting"
        ),
        pytest.param(
            (False, False, False, False), "framework-default", id="drf-default"
        ),
    ],
)
def test_rules_precedence(flags: tuple[bool, bool, bool, bool], layer: str) -> None:
    override, action, attribute, setting = flags
    assert (
        drf_layer(
            overrides_get_permissions=override,
            action_kwargs=action,
            class_attribute=attribute,
            setting=setting,
        )
        == layer
    )


@pytest.mark.parametrize(
    ("method", "value"),
    [("GET", "optional"), ("HEAD", "optional"), ("POST", "required")],
)
def test_rules_read_only_is_per_method(method: str, value: str) -> None:
    authn, authz, _ = resolve([READ_ONLY], method, "/catalog/", [], [])
    assert (authn.value, authz.value) == (value, "none")
    assert authn.rule == "builtin:IsAuthenticatedOrReadOnly"


def test_rules_custom_permission_is_unknown() -> None:
    authn, authz, reason = resolve([IS_OWNER], "GET", "/orders/", [], [])
    assert authn == authz == Axis("unknown", "class", "IsOwner", None)
    assert reason is None


def test_rules_checks_combine_strictest_wins() -> None:
    authn, authz, _ = resolve([IS_AUTHENTICATED, IS_OWNER], "GET", "/orders/", [], [])
    assert authn == Axis(
        "required", "class", "IsAuthenticated", "builtin:IsAuthenticated"
    )
    assert authz == Axis("unknown", "class", "IsOwner", None)


def test_rules_tie_reports_the_check_met_first() -> None:
    authn, authz, _ = resolve([NO_CHECK], "GET", "/api/orders/", [TENANT], [])
    assert authn == Axis("required", "global", "Tenant", "recognition:tenant")
    assert authz == Axis("none", "global", "Tenant", "recognition:tenant")


def test_rules_recognition_rule_resolves_a_construct() -> None:
    owner = Rule(
        "owner",
        "shop/permissions.py:4",
        "required",
        "rule",
        construct="shop.permissions.IsOwner",
    )
    authn, authz, reason = resolve([IS_OWNER], "GET", "/orders/", [owner], [])
    assert authn == Axis("required", "class", "IsOwner", "recognition:owner")
    assert authz == Axis("rule", "class", "IsOwner", "recognition:owner")
    assert reason is None


@pytest.mark.parametrize(
    ("method", "value"),
    [("GET", "none"), ("OPTIONS", "none"), ("PATCH", "rule")],
)
def test_rules_recognition_rule_is_per_method(method: str, value: str) -> None:
    edit = Rule(
        "edit",
        "shop/permissions.py:4",
        "required",
        "rule",
        construct="shop.permissions.IsOwner",
        safe_authz="none",
    )
    authn, authz, _ = resolve([IS_OWNER], method, "/orders/1/", [edit], [])
    assert (authn.value, authz.value) == ("required", value)
    assert authz.rule == "recognition:edit"


def test_rules_any_endpoint_splits_when_a_rule_differs_per_method() -> None:
    edit = Rule(
        "edit",
        "shop/permissions.py:4",
        "required",
        "rule",
        construct="shop.permissions.IsOwner",
        safe_authz="none",
    )
    split = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    assert methods([IS_OWNER], "ANY", "/orders/1/", [edit]) == split
    assert methods([IS_AUTHENTICATED], "ANY", "/orders/1/", [edit]) == ["ANY"]
    assert methods([IS_OWNER], "GET", "/orders/1/", [edit]) == ["GET"]


@pytest.mark.parametrize(
    "ack",
    [
        Ack("ownership is data", construct="shop.permissions.IsOwner"),
        Ack("ownership is data", path="/orders/"),
    ],
    ids=["by-construct", "by-path"],
)
def test_rules_acknowledged_unknown(ack: Ack) -> None:
    assert resolve([IS_OWNER], "GET", "/orders/", [], [ack])[2] == "ownership is data"


def test_rules_script_reason_on_unreadable_callable() -> None:
    hook = Finding(
        "shop.views.Hook",
        None,
        "shop.views.Hook",
        reason="shop.views.Hook is not a Django view",
    )
    authn, _, reason = resolve([hook], "ANY", "/hooks/", [], [])
    assert (authn.value, reason) == ("unknown", "shop.views.Hook is not a Django view")


def test_rules_login_required_middleware() -> None:
    middleware = ["django.contrib.auth.middleware.LoginRequiredMiddleware"]
    assert global_findings(middleware, login_required=False) == []
    assert global_findings([], login_required=True) == []
    (finding,) = global_findings(middleware, login_required=True)
    authn, authz, _ = resolve([finding, NO_CHECK], "GET", "/", [], [])
    assert authn == Axis(
        "required",
        "global",
        "LoginRequiredMiddleware",
        "builtin:LoginRequiredMiddleware",
    )
    assert authz.value == "none"


def test_rules_evidence_must_exist(tmp_path: Path) -> None:
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "middleware.py").write_text("class Tenant:\n    pass\n")
    check_rules([TENANT], tmp_path)
    with pytest.raises(RuleError, match="past the end"):
        check_rules(
            [
                Rule(
                    "tenant",
                    "config/middleware.py:3",
                    "required",
                    "none",
                    path_prefix="/",
                    layer="global",
                )
            ],
            tmp_path,
        )
    with pytest.raises(RuleError, match="does not exist"):
        check_rules(
            [Rule("gone", "config/gone.py:1", "required", "none", construct="x")],
            tmp_path,
        )
    outside = tmp_path.parent / "outside.py"
    outside.write_text("x = 1\n")
    for evidence in (f"{outside}:1", "../outside.py:1"):
        with pytest.raises(RuleError, match="does not exist"):
            check_rules(
                [Rule("escape", evidence, "required", "none", construct="x")],
                tmp_path,
            )
    with pytest.raises(RuleError, match="exactly one"):
        check_rules(
            [
                Rule(
                    "both",
                    "config/middleware.py:1",
                    "required",
                    "none",
                    construct="x",
                    path_prefix="/",
                )
            ],
            tmp_path,
        )
