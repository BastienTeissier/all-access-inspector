# Django reference

## Where access is decided, by layer

| Layer | Django / DRF construct | Read by the Base Script |
|---|---|---|
| `global` | `MIDDLEWARE` | only `LoginRequiredMiddleware` (Django 5.1+), honouring `@login_not_required` |
| `global` | `REST_FRAMEWORK["DEFAULT_PERMISSION_CLASSES"]` | yes, for DRF views that set nothing themselves |
| `global` | admin sites (`admin.site`, custom `AdminSite`) | yes: `is_staff`, or unknown when `has_permission`/`admin_view` is overridden |
| `class` | `permission_classes`, `LoginRequiredMixin`, `PermissionRequiredMixin`, `UserPassesTestMixin` | yes |
| `method` | `@login_required`, `@permission_required`, `@user_passes_test`, `@action(permission_classes=…)`, `get_permissions()` overrides, project decorators | yes; project decorators and `test_func`s are unknown until a rule names them |
| `framework-default` | a view with no check; DRF with no `DEFAULT_PERMISSION_CLASSES` (`AllowAny`) | yes, `builtin:no_check` |

## Production entry

Look for the settings module production runs, in this order:

1. `DJANGO_SETTINGS_MODULE` in `Dockerfile`, `docker-compose*.yml` (the production service), `Procfile`, `app.yaml`, Helm or Kubernetes manifests, `wsgi.py`/`asgi.py` defaults.
2. A module named `production`, `prod` or `live` under a `settings/` package (`config/settings/production.py`).
3. A single settings module that branches on environment variables. Use it as is, and pin what production sets (`DEBUG=False`).

`manage.py` usually defaults to a dev module, so `ENTRY = None` is rarely right. When production settings and dev settings mount different URLs (`if DEBUG: urlpatterns += …`, `debug_toolbar`), the production module is the one that counts.

## Boot failure → stub cookbook

Stub the narrowest dotted name the traceback points at. Never stub the settings module or anything under its package.

| Symptom in the traceback | Toward-production fix |
|---|---|
| `KeyError`/`ImproperlyConfigured` for `SECRET_KEY` or another secret | stub the function outside the settings package that loads it, e.g. `Stub("config.secrets.load", reason=…, replacement=lambda: {"SECRET_KEY": "inventory-stub"})`; when the settings read `os.environ` directly, there is nothing to stub: ask the user |
| A secrets-manager / vault client (`boto3`, `hvac`, `google.cloud.secretmanager`, Azure Key Vault) called at import | stub that client call with a replacement returning a placeholder of the right shape |
| `ModuleNotFoundError` for a production-only package | stub the importing function, or ask whether the package belongs in the run environment |
| Database connection at import or in `AppConfig.ready()` | stub the function that queries; `django.setup()` itself opens no connection |
| Cache, broker, search, storage client connecting at import (`redis`, `celery`, `elasticsearch`, `storages`) | stub the client factory |
| A required non-secret environment variable (`env("X")` with no default) | ask the user for the production value and how they want it provided; never invent one |
| `DEBUG` derived from the environment, default `True` | `Pin("DEBUG", False, reason="production value; …")`; if `DEBUG` shapes `INSTALLED_APPS` or the URLconf at import, pick a production `ENTRY` instead |
| `ALLOWED_HOSTS` empty with `DEBUG=False` | does not affect the route table; leave it |
| URLconf import fails | real code error: report it to the user, do not stub it |

A `Stub` is patched before the settings import and stays active during `django.setup()` and the URLconf import. `replacement=None` gives a `MagicMock`.

## Built-in rules

| Construct | authentication | authorization |
|---|---|---|
| DRF `AllowAny` | anonymous | none |
| DRF `IsAuthenticated` | required | none |
| DRF `IsAdminUser` | required | rule |
| DRF `IsAuthenticatedOrReadOnly` | optional on GET/HEAD/OPTIONS, else required | none |
| DRF `DjangoModelPermissions` | required | none on GET/HEAD/OPTIONS, else rule |
| `login_required`, `LoginRequiredMixin`, `LoginRequiredMiddleware` | required | none |
| `permission_required`, `PermissionRequiredMixin` | required | rule |
| Django admin (`is_staff`) | required | rule |
| no check | anonymous | none |

Several checks on one endpoint all apply: per axis the strictest wins (`required` > `unknown` > `optional` > `anonymous`; `unknown` > `rule` > `none`).

## Writing a Recognition Rule

- `construct` is the dotted name the script saw: `module.QualName` of the permission class, decorator wrapper or `test_func`. The `raw` of a DRF permission is only its class name; import path + name gives the dotted form.
- `evidence` is the line of the `class`/`def` that implements the check, relative to the project root, never a usage site.
- `authn`: `required` when the check rejects anonymous users, `optional` when it only reads `request.user`, `anonymous` when it lets everyone in.
- `authz`: `rule` when it checks anything beyond "is authenticated" (role, group, permission, tenant, ownership enforced in the check), `none` otherwise.
- A check combining others (`IsAuthenticated & IsOwner`, a subclass of `IsAuthenticated`): classify what the whole class enforces.
- Middleware enforcing a prefix: `path_prefix="/api/"`, `layer="global"`, `raw="<MiddlewareClass>"`, evidence on the line that rejects the request.

## Acknowledged Unknowns

Use them when the decision is data-dependent or out of scope, with a reason the reviewer can verify in one read:

- A permission with only `has_object_permission` (ownership compared on the object): it never runs on list or create, so `rule` would overstate it; acknowledge it with that reason.
- GraphQL, WebSocket, server-sent events endpoints → `path=`, "operations are out of scope; authorization is enforced per resolver/consumer".
- `get_permissions()` that needs a real request or object.
- An external policy engine (OPA, Casbin) whose policy is not in the repository.

## Blind spots

- Custom middleware is not read. An endpoint behind an authenticating middleware still reads `no_check`/`anonymous` until a `path_prefix` rule covers it. Always review `MIDDLEWARE`.
- `authentication_classes` are not read: they say how a user is identified, not whether one is required.
- `method_decorator` on `dispatch` or a handler is unknown (decorators are hidden until call time); write a rule for the dotted method name the script reports.
- Checks inside the view body (`if not request.user.is_staff: raise PermissionDenied`) are invisible: the endpoint reads `no_check`. Grep handlers flagged `anonymous` for `PermissionDenied`, `raise Http404`, `request.user` before accepting them.
- Settings derived from `DEBUG` at import time keep their dev value under a `DEBUG` pin.
- Mounted non-Django apps (ASGI sub-apps, `django-ninja` routers outside the resolver) appear as one unknown endpoint naming the callable.
- Several URL patterns resolving to one endpoint with different checks are unknown: the first matching pattern wins at runtime.

## Candidate dimensions

Propose from what the fitting found, never from naming alone:

- Path prefix groups that share a guard: `/api/` behind a tenant middleware, `/admin/`, `/hooks/` (webhooks), `/health/`.
- Admin sites → a `staff` / `back-office` value.
- Roles or groups named in Recognition Rules (`IsManager`, `CompanyAdmin`) → audience values.
- Public catalog or auth pages (`/accounts/login/`, `/password_reset/`) → `public`.

Typical shape: `access_tier` with `public`, `customer`, `staff`. Write assignment rules as path predicates, most specific first.
