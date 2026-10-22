GOLANGCI_VERSION := $(shell cat .golangciversion)
GOLANGCI_LINT := $(CURDIR)/backend/bin/golangci-lint

.PHONY: run check frontend-check backend-check backend-lint backend-format-check backend-format backend-test install-golangci-lint install-hooks build frontend-build backend-build backend-run generate frontend-generate backend-generate

check: frontend-check backend-check

frontend-check:
	@echo "==> Frontend: lint"
	cd frontend && npm run lint
	@echo "==> Frontend: formatting"
	cd frontend && npm run format:check
	@echo "==> Frontend: tests"
	cd frontend && npm test
	@echo "==> Frontend: type-check and build"
	cd frontend && npm run build

backend-check: backend-lint backend-format-check backend-test

backend-lint: backend-generate install-golangci-lint
	@echo "==> Backend: golangci-lint (includes go vet)"
	cd backend && "$(GOLANGCI_LINT)" run ./...

backend-format-check: backend-generate install-golangci-lint
	@echo "==> Backend: formatting"
	cd backend && "$(GOLANGCI_LINT)" fmt --diff ./...

backend-format: backend-generate install-golangci-lint
	@echo "==> Backend: applying formatting"
	cd backend && "$(GOLANGCI_LINT)" fmt ./...

backend-test: backend-generate
	@echo "==> Backend: go test"
	cd backend && go test ./...

install-golangci-lint:
	@set -eu; \
	if [ "$$("$(GOLANGCI_LINT)" version --short 2>/dev/null)" != "$(GOLANGCI_VERSION)" ]; then \
		echo "==> Installing golangci-lint v$(GOLANGCI_VERSION)"; \
		installer=$$(mktemp); \
		trap 'rm -f "$$installer"' EXIT HUP INT TERM; \
		curl -fsSL https://golangci-lint.run/install.sh -o "$$installer"; \
		sh "$$installer" -b "$(CURDIR)/backend/bin" "v$(GOLANGCI_VERSION)"; \
	fi

install-hooks:
	git config --local core.hooksPath .githooks
	@echo "Git hooks installed: make check will run before each push."

generate: frontend-generate backend-generate

frontend-generate:
	@echo "==> Frontend: generating API client"
	cd frontend && npm run generate:api

backend-generate:
	@echo "==> Backend: generating API server bindings"
	cd backend && go generate ./internal/api

build: frontend-build backend-build

frontend-build:
	@echo "==> Frontend: type-check and build"
	cd frontend && npm run build

backend-build: backend-generate
	@echo "==> Backend: build"
	cd backend && go build -o bin/server ./cmd/server

backend-run: backend-generate
	@echo "==> Backend: run server"
	cd backend && go run ./cmd/server

run: build
	@echo "==> Running production frontend and API together (default: http://localhost:8080; Ctrl+C to stop)"
	cd backend && FRONTEND_DIST="$(CURDIR)/frontend/dist" ./bin/server
