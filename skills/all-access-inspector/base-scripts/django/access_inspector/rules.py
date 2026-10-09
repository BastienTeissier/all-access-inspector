"""Built-in Rules, Recognition Rules and Acknowledged Unknowns; turns findings into the Core Classification."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from access_inspector.inventory import Axis

SAFE_METHODS = ("GET", "HEAD", "OPTIONS")
AUTHENTICATION_STRICTNESS = ("required", "unknown", "optional", "anonymous")
AUTHORIZATION_STRICTNESS = ("unknown", "rule", "none")


@dataclass(frozen=True)
class Finding:
    """One access check the classifier saw on an endpoint, named by its dotted construct."""

    construct: str
    layer: str | None
    raw: str | None
    reason: str | None = None  # set when the script cannot read the construct at all


@dataclass(frozen=True)
class Builtin:
    name: str
    authn: str
    authz: str
    safe_authn: str | None = None  # value for GET/HEAD/OPTIONS when it differs
    safe_authz: str | None = None


@dataclass(frozen=True)
class Rule:
    """A Recognition Rule: maps a project construct, or every path under a prefix, onto the Core Classification."""

    name: str
    evidence: str  # "relative/path.py:line" of the construct the rule interprets
    authn: str
    authz: str
    construct: str | None = None
    path_prefix: str | None = None
    layer: str | None = (
        None  # defaults to the finding's layer; required with path_prefix
    )
    raw: str | None = None
    safe_authn: str | None = (
        None  # value for GET/HEAD/OPTIONS when it differs, as for a Built-in Rule
    )
    safe_authz: str | None = None


@dataclass(frozen=True)
class Ack:
    """An Acknowledged Unknown: the written reason an unknown endpoint stays unknown."""

    reason: str
    construct: str | None = None
    path: str | None = None


class RuleError(Exception):
    pass


BUILTIN = {
    "rest_framework.permissions.AllowAny": Builtin("AllowAny", "anonymous", "none"),
    "rest_framework.permissions.IsAuthenticated": Builtin(
        "IsAuthenticated", "required", "none"
    ),
    "rest_framework.permissions.IsAdminUser": Builtin(
        "IsAdminUser", "required", "rule"
    ),
    "rest_framework.permissions.IsAuthenticatedOrReadOnly": Builtin(
        "IsAuthenticatedOrReadOnly", "required", "none", safe_authn="optional"
    ),
    "rest_framework.permissions.DjangoModelPermissions": Builtin(
        "DjangoModelPermissions", "required", "rule", safe_authz="none"
    ),
    "django.contrib.auth.decorators.login_required": Builtin(
        "login_required", "required", "none"
    ),
    "django.contrib.auth.decorators.permission_required": Builtin(
        "permission_required", "required", "rule"
    ),
    "django.contrib.auth.mixins.LoginRequiredMixin": Builtin(
        "LoginRequiredMixin", "required", "none"
    ),
    "django.contrib.auth.mixins.PermissionRequiredMixin": Builtin(
        "PermissionRequiredMixin", "required", "rule"
    ),
    "django.contrib.auth.middleware.LoginRequiredMiddleware": Builtin(
        "LoginRequiredMiddleware", "required", "none"
    ),
    "django.contrib.admin": Builtin("django_admin", "required", "rule"),
    "no_check": Builtin("no_check", "anonymous", "none"),
}

# --- project ---
# Recognition Rules. Each cites the file and line of the construct it interprets, e.g.:
# Rule(name="IsOrderOwner", evidence="orders/permissions.py:12", authn="required", authz="rule",
#      construct="orders.permissions.IsOrderOwner"),
RECOGNITION: list[Rule] = []

# Acknowledged Unknowns, e.g.:
# Ack(reason="GraphQL operations are out of scope; authorization is enforced per resolver", path="/graphql/"),
ACKNOWLEDGED: list[Ack] = []
# --- end project ---


def drf_layer(
    *,
    overrides_get_permissions: bool,
    action_kwargs: bool,
    class_attribute: bool,
    setting: bool,
) -> str:
    """The layer that set a DRF view's permission classes: method > class > global > framework-default."""
    if overrides_get_permissions or action_kwargs:
        return "method"
    if class_attribute:
        return "class"
    return "global" if setting else "framework-default"


def global_findings(middleware: list[str], login_required: bool) -> list[Finding]:
    """Checks every request passes through; login_required is False for @login_not_required views."""
    construct = "django.contrib.auth.middleware.LoginRequiredMiddleware"
    if construct in middleware and login_required:
        return [Finding(construct, "global", "LoginRequiredMiddleware")]
    return []


def resolve(
    findings: list[Finding],
    method: str,
    path: str,
    recognition: list[Rule] | None = None,
    acknowledged: list[Ack] | None = None,
) -> tuple[Axis, Axis, str | None]:
    """All checks apply: per axis the strictest component wins, and the first one holding that value is reported.

    Components are in request order (path rules, then findings as the classifier lists them: global, decorators,
    view), so on a tie the check a request meets first is the one reported.
    """
    recognition = RECOGNITION if recognition is None else recognition
    acknowledged = ACKNOWLEDGED if acknowledged is None else acknowledged
    own = [_component(f, method, recognition) for f in findings]
    components = [
        _recognised(r, method, r.layer, r.raw)
        for r in recognition
        if r.path_prefix is not None and path.startswith(r.path_prefix)
    ] + own
    if not components:
        raise RuleError(f"{method} {path}: no finding to classify")
    authn = _strictest([c[0] for c in components], AUTHENTICATION_STRICTNESS)
    authz = _strictest([c[1] for c in components], AUTHORIZATION_STRICTNESS)
    if "unknown" not in (authn.value, authz.value):
        return authn, authz, None
    unknown = {
        f.construct
        for f, c in zip(findings, own)
        if "unknown" in (c[0].value, c[1].value)
    }
    for ack in acknowledged:
        if ack.path == path or (ack.construct is not None and ack.construct in unknown):
            return authn, authz, ack.reason
    reasons = [f.reason for f in findings if f.reason and f.construct in unknown]
    return authn, authz, reasons[0] if reasons else None


def check_rules(recognition: list[Rule], root: Path) -> None:
    """Every Recognition Rule targets one thing and cites a file and line that exist."""
    for rule in recognition:
        if (rule.construct is None) == (rule.path_prefix is None):
            raise RuleError(
                f"rule {rule.name}: set exactly one of construct or path_prefix"
            )
        if rule.path_prefix is not None and rule.layer is None:
            raise RuleError(f"rule {rule.name}: a path_prefix rule needs a layer")
        file, _, line = rule.evidence.rpartition(":")
        source = (root / file).resolve()
        inside = source.is_relative_to(root.resolve())
        if not (file and line.isdigit() and inside and source.is_file()):
            raise RuleError(
                f"rule {rule.name}: evidence {rule.evidence} does not exist"
            )
        if not 1 <= int(line) <= len(source.read_text(encoding="utf-8").splitlines()):
            raise RuleError(
                f"rule {rule.name}: evidence {rule.evidence} is past the end of the file"
            )


def _component(
    finding: Finding, method: str, recognition: list[Rule]
) -> tuple[Axis, Axis]:
    for rule in recognition:
        if rule.construct == finding.construct:
            return _recognised(
                rule, method, rule.layer or finding.layer, rule.raw or finding.raw
            )
    builtin = BUILTIN.get(finding.construct) if finding.reason is None else None
    if builtin is None:
        return _axis("unknown", finding.layer, finding.raw, None), _axis(
            "unknown", finding.layer, finding.raw, None
        )
    safe = method in SAFE_METHODS
    authn = (builtin.safe_authn if safe else None) or builtin.authn
    authz = (builtin.safe_authz if safe else None) or builtin.authz
    tag = f"builtin:{builtin.name}"
    return _axis(authn, finding.layer, finding.raw, tag), _axis(
        authz, finding.layer, finding.raw, tag
    )


def _recognised(
    rule: Rule, method: str, layer: str | None, raw: str | None
) -> tuple[Axis, Axis]:
    safe = method in SAFE_METHODS
    authn = (rule.safe_authn if safe else None) or rule.authn
    authz = (rule.safe_authz if safe else None) or rule.authz
    tag = f"recognition:{rule.name}"
    return _axis(authn, layer, raw, tag), _axis(authz, layer, raw, tag)


def _axis(value: str, layer: str | None, raw: str | None, rule: str | None) -> Axis:
    return Axis(
        value=value, layer=layer, raw=raw, rule=None if value == "unknown" else rule
    )


def _strictest(axes: list[Axis], order: tuple[str, ...]) -> Axis:
    winner = min(order.index(a.value) for a in axes)
    return next(a for a in axes if order.index(a.value) == winner)
