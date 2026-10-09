DJANGO := base-scripts/django
UV_DJANGO := uv run --directory $(DJANGO)

.PHONY: test test-django lint typecheck check-all format

test: test-django

test-django:
	$(UV_DJANGO) pytest

lint:
	$(UV_DJANGO) ruff check .
	$(UV_DJANGO) ruff format --check .

typecheck:
	$(UV_DJANGO) mypy .

check-all: lint typecheck

format:
	$(UV_DJANGO) ruff check --select I --fix .
	$(UV_DJANGO) ruff format .
