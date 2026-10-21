# Reviewlet

A snippet review application with an interactive React frontend and a mock API. The Go backend and OpenAPI contract remain skeletons.

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
npm test             # Run frontend interaction and mock API tests
```

Generated build output, coverage, and the npm lockfile are excluded from formatting.

### Mock review workspace

The frontend works without the Go server. Dark mode is the default; the header toggle switches to light mode and remembers your preference. The main workspace contains a full-height code editor with an editable snippet name in its title bar. The collapsible sidebar lists your saved snippets and keeps the Reviewlet logo visible.

Create a snippet with **New snippet**, rename it in the title bar, and edit its code. Hover a sidebar snippet (or focus it with the keyboard) to reveal its red delete button. Deletions are saved locally, including an empty library. An empty library shows a landing page introducing intelligent code reviews, with an illustrative finding and suggested fix and a button to create the first snippet. Edits save locally when you leave a field or switch snippets. Up to 20 snippets are stored in this browser; clear the site's browser data to reset the demo. Storage-disabled sessions continue in memory. Authentication and server-side ownership are not implemented yet.

Review findings and discussion controls are hidden for now. The asynchronous mock API remains in `src/api/mock.ts`; it can later be replaced with HTTP calls. No code is sent to a server or AI service. Syntax highlighting currently uses a lightweight regex tokenizer, not a language parser.

## Backend

Requires Go 1.27 or newer. In a separate terminal:

```sh
cd backend
go run ./cmd/server
```

The server listens on port 8080. No routes are registered, so requests return 404.
The frontend development server proxies `/api` requests to this server.
Run `go test ./...` to check compilation; no tests are defined yet.

Backend linting uses golangci-lint, pinned in the root `.golangciversion` file, with configuration in `backend/.golangci.yml`. The standard linter set includes `govet`, and formatting uses `gofmt` and `goimports`. From the repository root:

```sh
make backend-check         # Run lint, formatting checks, and tests
make backend-lint          # Run golangci-lint
make backend-format-check  # Report formatting differences without changing files
make backend-format        # Apply formatting fixes
```

These targets automatically download the pinned binary to the ignored `backend/bin/` directory when it is missing or has the wrong version. The first run requires curl and network access; later runs reuse the binary. Change `.golangciversion` to upgrade the tool for both local checks and CI. This follows [NilAway's version-pinning approach](https://github.com/uber-go/nilaway/blob/main/Makefile).

## API contract

`api/openapi.yaml` is intentionally empty (`paths: {}`). Define endpoints here before implementing them. Client and server code generation is not configured yet.

## Checks

After installing frontend dependencies with `cd frontend && npm ci`, run from the repository root:

```sh
make check
```

This always runs frontend linting, formatting checks, tests, type-checking, and a production build, plus golangci-lint, formatting checks, and `go test` for the backend. Backend tests are not defined yet.
Use `make frontend-check` or `make backend-check` to run either component separately.

Enable the pre-push hook once per checkout:

```sh
make install-hooks
```

The hook runs `make check` before every push and blocks the push if any check fails. Frontend dependencies must be installed, and Node.js, npm, Go, Make, and curl must be available on your PATH. Hook installation sets this checkout's `core.hooksPath` to the versioned `.githooks/` directory.

GitHub Actions runs these same targets in separate frontend and backend workflows on pull requests and pushes to `main`. The backend workflow ignores changes under `frontend/`, Markdown files at any depth, and the root `LICENSE` and `.gitignore` files; the frontend workflow ignores `backend/`, Markdown files, `LICENSE`, and `.gitignore`. Each workflow runs if any changed file falls outside its ignored paths. Either workflow can also be started manually from the Actions tab.
