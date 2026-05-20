SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
.PHONY: help install dev dev-worker build test typecheck lint format check up up-dev up-obs down logs ps clean smoke db-generate db-migrate db-migrate-dev db-seed db-studio db-reset backup restore

# Compose handles. The `--env-file deploy/compose/.env.local-defaults`
# supplies stub values for the `${VAR:?required}` references in
# docker-compose.yml so local dev / smoke / CI all work without a
# customer .env. Customer installs invoke compose without --env-file
# (compose then reads .env at the repo root).
COMPOSE_ENV_FILE := --env-file deploy/compose/.env.local-defaults
COMPOSE := docker compose $(COMPOSE_ENV_FILE) -f deploy/compose/docker-compose.yml
COMPOSE_DEV := $(COMPOSE) -f deploy/compose/docker-compose.build.yml -f deploy/compose/docker-compose.dev.yml

# ----- Meta ----------------------------------------------------------------
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make <target>\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# ----- Workspace -----------------------------------------------------------
install: ## Install workspace deps + generate Prisma client + install hooks
	bun install
	bun run prepare
	$(MAKE) db-generate

dev: ## Start the web app in dev mode
	bun run dev

dev-worker: ## Start the worker in dev mode
	bun run dev:worker

build: ## Build all packages
	bun run build

test: ## Run all tests
	bun run test

preflight: ## Probe Postgres + Redis the tests need
	bun run scripts/check-services.ts

test-integration: preflight ## Preflight services, then run the full Vitest suite
	bun run test

typecheck: ## Type-check all packages
	bun run typecheck

lint: ## Lint with Biome (and Next ESLint for apps/web)
	bun run lint
	bun run lint:next

format: ## Format with Biome
	bun run format

check: ## Biome combined check + autofix
	bun run check

clean: ## Remove build artifacts and node_modules
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/*/.next apps/*/dist packages/*/dist packages/db/generated
	find . -name '*.tsbuildinfo' -type f -delete

# ----- Compose stack -------------------------------------------------------
up: ## Start the stack (prod-like, no host port exposure)
	$(COMPOSE) up -d

up-dev: ## Start the stack with dev overrides (host ports exposed)
	$(COMPOSE_DEV) up -d

up-obs: ## Start the stack + observability profile (otel-collector, loki, tempo, prometheus, grafana)
	$(COMPOSE_DEV) --profile obs up -d

down: ## Stop the stack
	$(COMPOSE) down

logs: ## Tail logs of all services
	$(COMPOSE) logs -f --tail=100

ps: ## Show running services
	$(COMPOSE) ps

# ----- Database ------------------------------------------------------------
db-generate: ## Regenerate the Prisma client
	bun --filter @app/db generate

db-migrate-dev: ## Create + apply a new migration in dev
	bun --filter @app/db migrate:dev

db-migrate: ## Apply pending migrations (production-style)
	bun --filter @app/db migrate:deploy

db-seed: ## Seed the database
	bun --filter @app/db seed

db-studio: ## Open Prisma Studio
	bun --filter @app/db studio

db-reset: ## Drop, recreate, migrate, seed (DANGEROUS — dev only)
	bun --filter @app/db migrate:reset

# ----- Operations ---------------------------------------------------------
backup: ## Create a backup of all data (databases + redis snapshot) into ./backups/<UTC-timestamp>/
	deploy/scripts/backup.sh

restore: ## Restore from a backup directory: make restore DIR=./backups/<timestamp>
	deploy/scripts/restore.sh $(DIR)

smoke: ## Run end-to-end smoke test (build + up + verify endpoints + backup roundtrip)
	deploy/scripts/smoke.sh

smoke-quick: ## Smoke test without rebuilding images
	deploy/scripts/smoke.sh --no-build

smoke-clean: ## Smoke test then tear down the stack and volumes
	deploy/scripts/smoke.sh --teardown
