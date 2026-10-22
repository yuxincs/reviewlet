# Reviewlet

A snippet review application with an interactive React frontend and a mock API. The Go backend remains a skeleton; the review HTTP contract is defined in OpenAPI.

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

Generated API code, build output, coverage, and the npm lockfile are excluded from formatting.

### Mock review workspace

The frontend works without the Go server. Dark mode is the default. The header’s **Review snippet** button runs the local mock reviewer; **Command+Enter** (or **Ctrl+Enter**) runs the same action. Empty snippets cannot be submitted. Review completion is announced to screen readers without a visible banner. Findings highlight the affected code lines and gutter: red for high priority, amber for medium priority, and blue for suggestions. Code edits clear the highlights until the next review; renaming keeps them. Click a highlighted code line or its line number to open an animated review popover below the last line of the focused portion. Steps with symbol links anchor below their last linked line; other steps anchor below the finding’s range. The editor leaves room beneath the focused code, and the panel scrolls within the available space. Click elsewhere or press Escape to dismiss it; **Alt+Enter** also opens the finding on the current line. Each finding has a one-line summary containing severity (**critical**, **warning**, **info**), category (**bug**, **style**, **performance**, **security**), and concise title; the clicked editor line supplies the location. While the panel is focused, use **Left/Right arrow keys** for explanation steps and **Up/Down arrow keys** for findings in code order. Navigation stops at either end; switching findings starts at its first step. Numbered explanation steps can include symbol links; selecting a step highlights its linked symbols and dims unrelated code and line numbers. Steps without links keep the finding’s line or range bright; closing the panel restores the full editor. The selected step automatically shows animated curves between mapped code symbols in the editor. Variable colors derive from symbol identity for any snippet, with optional scope-qualified IDs; each flow segment uses its own destination symbol’s color. Curves avoid symbol boxes and prefer routes without crossings. The review panel contains concise steps and symbol links without a separate flow diagram. The flow updates automatically when you select a step or use the arrow keys. Proposed fixes are explicitly labeled; abstract nodes never create fabricated code connections. Motion respects the system’s reduced-motion preference. Suggested code follows the steps. The popover shows only the finding for the clicked line. The exact database example adds prepared explanations with linked variable highlights; click a variable reference to jump to its line. Editing clears the findings and closes the popover. Linked variables are prepared demo content, not live AI or automatic data-flow analysis. The main workspace contains a full-height code editor with an editable snippet name in its title bar. The collapsible sidebar lists your saved snippets and keeps the Reviewlet logo visible.

Create a snippet with **New snippet**, rename it in the title bar, and edit its code. Hover a sidebar snippet (or focus it with the keyboard) to reveal its red delete button. Deletions are saved locally, including an empty library. An empty library shows a landing page introducing intelligent code reviews, with an illustrative finding and suggested fix and buttons to create a blank snippet or try a prefilled demo. Edits save locally when you leave a field or switch snippets. Up to 20 snippets are stored in this browser; clear the site's browser data to reset the demo. Storage-disabled sessions continue in memory. Authentication and server-side ownership are not implemented yet.

Review findings and discussion controls are hidden for now. The asynchronous mock API remains in `src/api/mock.ts`; it can later be replaced with HTTP calls. No code is sent to a server or AI service. Syntax highlighting currently uses a lightweight regex tokenizer, not a language parser.

## Backend

Requires Go 1.27 or newer. In a separate terminal:

```sh
make backend-run
```

The server listens on port 8080 by default; set `LISTEN_ADDR` to override the listen address. `POST /api/v1/review` returns an explicitly labeled dummy review with an empty findings array; no AI provider or credentials are needed. HTTP header/read/write/idle timeouts are configured, and SIGINT/SIGTERM trigger graceful shutdown.
The frontend development server proxies `/api` requests to this server.
Run `make backend-test` to generate bindings and test the dummy endpoint.

Backend linting uses golangci-lint, pinned in the root `.golangciversion` file, with configuration in `backend/.golangci.yml`. The standard linter set includes `govet`, and formatting uses `gofmt` and `goimports`. From the repository root:

```sh
make backend-check         # Run lint, formatting checks, and tests
make backend-lint          # Run golangci-lint
make backend-format-check  # Report formatting differences without changing files
make backend-format        # Apply formatting fixes
```

These targets automatically download the pinned binary to the ignored `backend/bin/` directory when it is missing or has the wrong version. The first run requires curl and network access; later runs reuse the binary. Change `.golangciversion` to upgrade the tool for both local checks and CI. This follows [NilAway's version-pinning approach](https://github.com/uber-go/nilaway/blob/main/Makefile).

## API contract

[`api/openapi.yaml`](api/openapi.yaml) defines `POST /api/v1/review`. Send `code` with optional `language` and `context`; receive a synchronous review containing a source hash, a short summary, and structured findings. Findings include severity/category, source locations, concise explanations, symbol references, directional flows, optional illustrative values, and exact replacement edits for applicable fixes. Examples cover a SQL injection finding and a completed review with no findings.

Locations use one-based lines and UTF-16 columns, with exclusive end columns. The returned `codeHash` is SHA-256 of the exact submitted UTF-8 source, allowing clients to detect stale results. The contract also defines validation, rate-limit, and provider error responses. [`api/review-generation.md`](api/review-generation.md) provides guidance for generating examples and edits.

This is the API design; the Go handler and frontend HTTP integration are not implemented yet. Generated bindings are ignored by Git and produced automatically:

- Go: `backend/internal/api/api.gen.go`, using `oapi-codegen` v2.8.0 (pinned as a Go tool in `backend/go.mod`). Includes models, standard `net/http` routes, and the typed `StrictServerInterface`.
- TypeScript: `frontend/src/api/generated/`, using Hey API v0.99.0 (pinned in `frontend/package.json`). Includes models, a Fetch client, and the `reviewSnippet` endpoint function.

After editing the specification, run from the repository root:

```sh
make generate                # Regenerate Go server bindings and TS client
make frontend-generate       # Regenerate only the TS client
make backend-generate        # Regenerate only the Go bindings
make build                   # Generate and build both components
make backend-build           # Generate and build backend/bin/server
```

Install frontend dependencies first with `cd frontend && npm ci`. Go downloads its pinned generator on first use. Frontend build, dev, lint, and test scripts generate the client before running. Backend Make targets generate the server bindings before building, running, linting, formatting, or testing. This also covers `make check`, the pre-push hook, and existing CI workflows. Edit the spec or generator configuration; do not edit generated files. Generated TS files skip lint/format checks but remain type-checked. Go does not run generation automatically for direct `go build`, `go run`, or `go test` commands: use the Make targets, or run `go generate ./internal/api` from `backend/` first.

Frontend callers can import `reviewSnippet` and request/response types from `frontend/src/api/client.ts`. The client uses the page's origin, including Vite's `/api` proxy during development. Calls return typed `data` or `error` with the HTTP response; callers still need to handle network errors. The UI continues to use the mock API.

The dummy service implements `api.StrictServerInterface` and uses generated routes for JSON binding and response serialization. Full validation and AI review generation will be added separately.

## Checks

After installing frontend dependencies with `cd frontend && npm ci`, run from the repository root:

```sh
make check
```

This always generates API bindings and runs frontend linting, formatting checks, tests, type-checking, and a production build, plus golangci-lint, formatting checks, and `go test` for the backend. Backend tests exercise the dummy endpoint.
Use `make frontend-check` or `make backend-check` to run either component separately.

Enable the pre-push hook once per checkout:

```sh
make install-hooks
```

The hook runs `make check` before every push and blocks the push if any check fails. Frontend dependencies must be installed, and Node.js, npm, Go, Make, and curl must be available on your PATH. Hook installation sets this checkout's `core.hooksPath` to the versioned `.githooks/` directory.

GitHub Actions runs these same targets in separate frontend and backend workflows on pull requests and pushes to `main`. The backend workflow ignores changes under `frontend/`, Markdown files at any depth, and the root `LICENSE` and `.gitignore` files; the frontend workflow ignores `backend/`, Markdown files, `LICENSE`, and `.gitignore`. Each workflow runs if any changed file falls outside its ignored paths. Either workflow can also be started manually from the Actions tab.
