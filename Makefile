SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
.PHONY: help install dev dev-worker build test typecheck lint format check up down logs ps clean smoke db-migrate db-seed backup restore

# ----- Meta ----------------------------------------------------------------
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make <target>\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# ----- Workspace -----------------------------------------------------------
install: ## Install all workspace dependencies
	bun install
	bun run prepare

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
	rm -rf apps/*/.next apps/*/dist packages/*/dist
	rm -rf **/*.tsbuildinfo

# ----- Compose stack (placeholder for Phase 2+) ----------------------------
up: ## Start the local stack (docker compose up -d)
	@echo "TODO Phase 2+: docker compose -f deploy/compose/docker-compose.yml up -d"

down: ## Stop the local stack
	@echo "TODO Phase 2+: docker compose -f deploy/compose/docker-compose.yml down"

logs: ## Tail logs of all services
	@echo "TODO Phase 2+: docker compose -f deploy/compose/docker-compose.yml logs -f"

ps: ## Show running services
	@echo "TODO Phase 2+: docker compose -f deploy/compose/docker-compose.yml ps"

# ----- Database (placeholder for Phase 2) ----------------------------------
db-migrate: ## Apply Prisma migrations
	@echo "TODO Phase 2: bun --filter @app/db migrate:deploy"

db-seed: ## Seed database
	@echo "TODO Phase 2: bun --filter @app/db seed"

# ----- Operations (placeholder for Phase 6) --------------------------------
backup: ## Create a backup
	@echo "TODO Phase 6: deploy/scripts/backup.sh"

restore: ## Restore from a backup
	@echo "TODO Phase 6: deploy/scripts/restore.sh"

smoke: ## Run end-to-end smoke test
	@echo "TODO Phase 8: deploy/scripts/smoke.sh"
