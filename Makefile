DJANGO := skills/all-access-inspector/base-scripts/django
DJANGO_FIXTURE := fixtures/django-demo
UV_DJANGO := uv run --locked --directory $(DJANGO)
UV_DJANGO_FIXTURE := uv run --locked --directory $(DJANGO_FIXTURE)
NESTJS := skills/all-access-inspector/base-scripts/nestjs
NESTJS_FIXTURE := fixtures/nestjs-demo
NESTJS_JEST_FIXTURE := fixtures/nestjs-jest-smoke
REVIEW := skills/all-access-inspector/review
REVIEW_APP := apps/review

.PHONY: test test-django test-nestjs test-review install-nestjs install-review lint typecheck typecheck-nestjs typecheck-review deps check-all format

test: test-django test-nestjs test-review

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

install-review:
	pnpm install --frozen-lockfile --dir $(REVIEW)
	pnpm install --frozen-lockfile --dir $(REVIEW_APP)

test-review:
	pnpm --dir $(REVIEW) exec vitest run
	pnpm --dir $(REVIEW_APP) exec vitest run
	pnpm --dir $(REVIEW_APP) exec playwright test

lint:
	$(UV_DJANGO) ruff check . $(CURDIR)/$(DJANGO_FIXTURE)
	$(UV_DJANGO) ruff format --check . $(CURDIR)/$(DJANGO_FIXTURE)

typecheck:
	$(UV_DJANGO) mypy .

typecheck-nestjs:
	pnpm --dir $(NESTJS) exec tsc --noEmit -p tsconfig.json
	pnpm --dir $(NESTJS_FIXTURE) exec tsc --noEmit -p tsconfig.json
	pnpm --dir $(NESTJS_JEST_FIXTURE) exec tsc --noEmit -p tsconfig.json

typecheck-review:
	pnpm --dir $(REVIEW) exec tsc --noEmit -p tsconfig.json
	pnpm --dir $(REVIEW_APP) exec tsc --noEmit -p tsconfig.json

deps:
	$(UV_DJANGO) deptry .

check-all: lint typecheck deps typecheck-nestjs typecheck-review

format:
	$(UV_DJANGO) ruff check --select I --fix . $(CURDIR)/$(DJANGO_FIXTURE)
	$(UV_DJANGO) ruff format . $(CURDIR)/$(DJANGO_FIXTURE)
