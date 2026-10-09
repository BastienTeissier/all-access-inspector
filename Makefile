DJANGO := skills/all-access-inspector/base-scripts/django
DJANGO_FIXTURE := fixtures/django-demo
UV_DJANGO := uv run --locked --directory $(DJANGO)
UV_DJANGO_FIXTURE := uv run --locked --directory $(DJANGO_FIXTURE)

.PHONY: test test-django lint typecheck deps check-all format

test: test-django

test-django:
	$(UV_DJANGO) pytest --cov
	$(UV_DJANGO_FIXTURE) pytest

lint:
	$(UV_DJANGO) ruff check . $(CURDIR)/$(DJANGO_FIXTURE)
	$(UV_DJANGO) ruff format --check . $(CURDIR)/$(DJANGO_FIXTURE)

typecheck:
	$(UV_DJANGO) mypy .

deps:
	$(UV_DJANGO) deptry .

check-all: lint typecheck deps

format:
	$(UV_DJANGO) ruff check --select I --fix . $(CURDIR)/$(DJANGO_FIXTURE)
	$(UV_DJANGO) ruff format . $(CURDIR)/$(DJANGO_FIXTURE)
