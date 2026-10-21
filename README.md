# Reviewlet

A skeleton for a snippet review application. Business logic and API endpoints are not implemented yet.

```text
frontend/   React + TypeScript, served with Vite
backend/    Go HTTP server
api/        OpenAPI specification (source of truth for the HTTP contract)
```

## Frontend

With a current Node.js LTS release and npm installed:

```sh
cd frontend
npm ci
npm run dev
```

Run `npm run build` to type-check and build the frontend.

Frontend code uses ESLint with type-aware TypeScript rules, React Hooks, and Fast Refresh checks. Prettier handles formatting; `eslint-config-prettier` disables conflicting lint rules. TypeScript stays on the 6.0 release line supported by typescript-eslint. Run these commands from `frontend/`:

```sh
npm run lint          # Check code quality; warnings fail the check
npm run lint:fix      # Apply available automatic lint fixes
npm run format:check  # Check formatting without modifying files
npm run format       # Format frontend files
```

Generated build output, coverage, and the npm lockfile are excluded from formatting.

## Backend

Requires Go 1.27 or newer. In a separate terminal:

```sh
cd backend
go run ./cmd/server
```

The server listens on port 8080. No routes are registered, so requests return 404.
The frontend development server proxies `/api` requests to this server.
Run `go test ./...` to check compilation; no tests are defined yet.

## API contract

`api/openapi.yaml` is intentionally empty (`paths: {}`). Define endpoints here before implementing them. Client and server code generation is not configured yet.

## Checks

After installing frontend dependencies with `cd frontend && npm ci`, run from the repository root:

```sh
make check
```

This always runs frontend linting, formatting checks, type-checking, and a production build, plus `go vet` and `go test` for the backend. No test suites are defined yet.
Use `make frontend-check` or `make backend-check` to run either component separately.

Enable the pre-push hook once per checkout:

```sh
make install-hooks
```

The hook runs `make check` before every push and blocks the push if any check fails. Frontend dependencies must be installed, and Node.js, npm, Go, and Make must be available on your PATH. Hook installation sets this checkout's `core.hooksPath` to the versioned `.githooks/` directory.

GitHub Actions runs these same targets in separate frontend and backend workflows on pull requests and pushes to `main`. The backend workflow ignores changes under `frontend/`, Markdown files at any depth, and the root `LICENSE` and `.gitignore` files; the frontend workflow ignores `backend/`, Markdown files, `LICENSE`, and `.gitignore`. Each workflow runs if any changed file falls outside its ignored paths. Either workflow can also be started manually from the Actions tab.
