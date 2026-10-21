.PHONY: check frontend-check backend-check

check: frontend-check backend-check

frontend-check:
	@echo "==> Frontend: type-check and build"
	cd frontend && npm run build

backend-check:
	@echo "==> Backend: go vet"
	cd backend && go vet ./...
	@echo "==> Backend: go test"
	cd backend && go test ./...
