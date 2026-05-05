SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
.PHONY: help install dev dev-worker build test typecheck lint format check up up-dev up-obs down logs ps clean smoke db-generate db-migrate db-migrate-dev db-seed db-studio db-reset backup restore

COMPOSE := docker compose -f deploy/compose/docker-compose.yml
COMPOSE_DEV := $(COMPOSE) -f deploy/compose/docker-compose.dev.yml

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

# ----- Operations (placeholder for Phase 6) --------------------------------
backup: ## Create a backup
	@echo "TODO Phase 6: deploy/scripts/backup.sh"

restore: ## Restore from a backup
	@echo "TODO Phase 6: deploy/scripts/restore.sh"

smoke: ## Run end-to-end smoke test
	@echo "TODO Phase 8: deploy/scripts/smoke.sh"
