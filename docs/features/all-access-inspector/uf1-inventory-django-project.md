# UF1: Inventory a Django project

**Notion ticket:** *(not requested)*

## Context

A developer or auditor wants to see every endpoint a conventional Django or DRF project exposes, with its authentication and authorization, before any Agent fitting. This is the Django Base Script run as-is, and it is the foundation every other flow builds on.

## Specification

AAU (developer, with the project's Python environment installed), running `python tools/access-inspector/inspect.py` from the project root, I see:
- an `inventory.json` written next to the script, valid against the shared schema, with `stack: django`, `discovery_mode: runtime`, `coverage: complete`
- one endpoint object per line, sorted by path then method, each with method, path pattern, handler as `file:line`, authentication, authorization and layer
- built-in rules applied per HTTP method for framework constructs: `AllowAny`, `IsAuthenticated`, `IsAuthenticatedOrReadOnly`, `IsAdminUser`, `DjangoModelPermissions`, `login_required`, `permission_required`, `LoginRequiredMixin`, `PermissionRequiredMixin`, DRF default classes from `REST_FRAMEWORK`, Django admin
- any construct not covered by a built-in rule reported as `unknown`
- with `--table`, a sortable table on the terminal rendered from the inventory, not committed

## Success Scenario

- AAU, the project has a viewset with `IsAuthenticatedOrReadOnly`, I see one endpoint per method with GET `optional` and POST `required`.
- AAU, the project has two views sharing a URL name and one view without a name, I see all three endpoints.
- AAU, the project uses `@action(permission_classes=[...])` or overrides `get_permissions()`, I see the per-action classification, not the class-level one.
- AAU, the project mounts the Django admin, I see each admin endpoint with authentication `required` at layer `global` and authorization `rule` with raw `is_staff`.

## Error Scenario

- AAU, the settings module cannot be imported, I see the import error and the settings module the script tried, and no `inventory.json` is written.
- AAU, the produced inventory violates the schema, I see the violation and no file is written.

## Edge Cases

- AAU, if a URL pattern is internationalised, I see one endpoint per configured language prefix.
- AAU, if a view declares no HTTP method restriction, I see a single endpoint with method `ANY`; a per-method rule such as `IsAuthenticatedOrReadOnly` still expands into explicit methods.
- AAU, if a custom `BasePermission` subclass is named `IsOwner`, I see `unknown` for authorization, not a guess.
- AAU, if a route is served by a non-Django callable mounted in `urlpatterns`, I see it with `unknown` on both dimensions and a reason naming the callable.
- AAU, if I run the script twice on the same commit, the two files are byte-identical.

## Acceptance Criteria

- [ ] The fixture project's inventory matches its committed golden file byte for byte.
- [ ] The fixture inventory validates against `schema/inventory.schema.json`.
- [ ] Every URL pattern of the fixture appears exactly once per HTTP method it serves.
- [ ] Each built-in rule listed above is exercised by at least one fixture endpoint.
- [ ] A custom permission class in the fixture yields `unknown`.
- [ ] `--table` prints a table and does not modify `inventory.json`.
