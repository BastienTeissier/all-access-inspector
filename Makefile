DJANGO := skills/all-access-inspector/base-scripts/django
DJANGO_FIXTURE := fixtures/django-demo
UV_DJANGO := uv run --locked --directory $(DJANGO)
UV_DJANGO_FIXTURE := uv run --locked --directory $(DJANGO_FIXTURE)
NESTJS := skills/all-access-inspector/base-scripts/nestjs
NESTJS_FIXTURE := fixtures/nestjs-demo
NESTJS_JEST_FIXTURE := fixtures/nestjs-jest-smoke

.PHONY: test test-django test-nestjs install-nestjs lint typecheck typecheck-nestjs deps check-all format

test: test-django test-nestjs

test-django:
	$(UV_DJANGO) pytest --cov
	$(UV_DJANGO_FIXTURE) pytest

install-nestjs:
	pnpm install --frozen-lockfile --dir $(NESTJS)
	pnpm install --frozen-lockfile --dir $(NESTJS_FIXTURE)
	pnpm install --frozen-lockfile --dir $(NESTJS_JEST_FIXTURE)

test-nestjs:
	pnpm --dir $(NESTJS) exec vitest run
	pnpm --dir $(NESTJS_FIXTURE) exec vitest run
	pnpm --dir $(NESTJS_JEST_FIXTURE) run test:golden

lint:
	$(UV_DJANGO) ruff check . $(CURDIR)/$(DJANGO_FIXTURE)
	$(UV_DJANGO) ruff format --check . $(CURDIR)/$(DJANGO_FIXTURE)

typecheck:
	$(UV_DJANGO) mypy .

typecheck-nestjs:
	pnpm --dir $(NESTJS) exec tsc --noEmit -p tsconfig.json
	pnpm --dir $(NESTJS_FIXTURE) exec tsc --noEmit -p tsconfig.json
	pnpm --dir $(NESTJS_JEST_FIXTURE) exec tsc --noEmit -p tsconfig.json

deps:
	$(UV_DJANGO) deptry .

check-all: lint typecheck deps typecheck-nestjs

format:
	$(UV_DJANGO) ruff check --select I --fix . $(CURDIR)/$(DJANGO_FIXTURE)
	$(UV_DJANGO) ruff format . $(CURDIR)/$(DJANGO_FIXTURE)
