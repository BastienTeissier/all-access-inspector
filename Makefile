DJANGO := skills/all-access-inspector/base-scripts/django
DJANGO_FIXTURE := fixtures/django-demo
UV_DJANGO := uv run --locked --directory $(DJANGO)
UV_DJANGO_FIXTURE := uv run --locked --directory $(DJANGO_FIXTURE)
NESTJS := skills/all-access-inspector/base-scripts/nestjs
NESTJS_FIXTURE := fixtures/nestjs-demo
NESTJS_JEST_FIXTURE := fixtures/nestjs-jest-smoke
SPRING := skills/all-access-inspector/base-scripts/spring
SPRING_FIXTURE := fixtures/spring-demo
SPRING_GRADLE_FIXTURE := fixtures/spring-gradle-smoke
# Java runs in a container, the Maven and Gradle caches in volumes; CI has a JDK and sets it empty.
SPRING_RUN ?= docker run --rm -v aai-m2:/root/.m2 -v aai-gradle:/root/.gradle -v $(CURDIR):/work -w /work eclipse-temurin:21-jdk
SYMFONY := skills/all-access-inspector/base-scripts/symfony
SYMFONY_FIXTURE := fixtures/symfony-demo
# PHP runs in a container, the Composer cache in a volume; CI has PHP and sets it empty.
SYMFONY_RUN ?= docker run --rm -v aai-composer:/tmp/cache -e COMPOSER_CACHE_DIR=/tmp/cache -v $(CURDIR):/work -w /work composer:2
REVIEW := skills/all-access-inspector/review
MAP := skills/all-access-inspector/map
REVIEW_APP := apps/review

.PHONY: test test-django test-nestjs test-spring test-symfony test-review install-nestjs install-symfony install-review lint typecheck typecheck-nestjs typecheck-review deps check-all format

test: test-django test-nestjs test-spring test-symfony test-review

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

test-spring:
	$(SPRING_RUN) $(SPRING)/mvnw -B -q -f $(SPRING)/pom.xml test
	$(SPRING_RUN) $(SPRING_FIXTURE)/tests/golden.sh
	$(SPRING_RUN) $(SPRING_GRADLE_FIXTURE)/tests/golden.sh

install-symfony:
	$(SYMFONY_RUN) composer install --no-interaction --no-progress -d $(SYMFONY)
	$(SYMFONY_RUN) composer install --no-interaction --no-progress --no-scripts -d $(SYMFONY_FIXTURE)

test-symfony:
	$(SYMFONY_RUN) $(SYMFONY)/vendor/bin/phpunit -c $(SYMFONY)/phpunit.xml
	$(SYMFONY_RUN) $(SYMFONY_FIXTURE)/tests/golden.sh

install-review:
	pnpm install --frozen-lockfile --dir $(REVIEW)
	pnpm install --frozen-lockfile --dir $(MAP)
	pnpm install --frozen-lockfile --dir $(REVIEW_APP)

test-review:
	pnpm --dir $(REVIEW) exec vitest run
	pnpm --dir $(MAP) exec vitest run
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
	pnpm --dir $(MAP) exec tsc --noEmit -p tsconfig.json
	pnpm --dir $(REVIEW_APP) exec tsc --noEmit -p tsconfig.json

deps:
	$(UV_DJANGO) deptry .

check-all: lint typecheck deps typecheck-nestjs typecheck-review

format:
	$(UV_DJANGO) ruff check --select I --fix . $(CURDIR)/$(DJANGO_FIXTURE)
	$(UV_DJANGO) ruff format . $(CURDIR)/$(DJANGO_FIXTURE)
