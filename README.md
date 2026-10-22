# Reviewlet

A snippet review application with an interactive React frontend and a Go review API backed by an OpenAI-compatible LLM provider. The frontend calls the Go API for reviews and persists its single-user snippet workspace in SQLite. The HTTP contract is defined in OpenAPI.

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
npm test             # Run frontend interaction and review adapter tests
```

Generated API code, build output, coverage, and the npm lockfile are excluded from formatting.

### Review workspace

The Go backend loads and saves the workspace; generating a review also requires a configured LLM provider. Dark mode is the default. The header’s **Review snippet** button calls `POST /api/v1/review` through the generated HTTP client; **Command+Enter** (or **Ctrl+Enter**) runs the same action. Empty snippets cannot be submitted. Review completion is announced to screen readers without a visible banner. Findings highlight the affected code lines and gutter: red for high priority, amber for medium priority, and blue for suggestions. Code edits clear the highlights until the next review; renaming keeps them. Click a highlighted code line or its line number to open an animated review popover below the last line of the focused portion. Steps with symbol links anchor below their last linked line; other steps anchor below the finding’s range. The editor leaves room beneath the focused code, and the panel scrolls within the available space. Click elsewhere or press Escape to dismiss it; **Alt+Enter** also opens the finding on the current line. Each finding has a one-line summary containing severity (**critical**, **warning**, **info**), category (**bug**, **style**, **performance**, **security**), and concise title; the clicked editor line supplies the location. While the panel is focused, use **Left/Right arrow keys** for explanation steps and **Up/Down arrow keys** for findings in code order. Navigation stops at either end; switching findings starts at its overview. Numbered explanation steps can include symbol links; selecting a step highlights its linked symbols and dims unrelated code and line numbers. Steps without links keep the finding’s line or range bright; closing the panel restores the full editor. The selected step automatically shows animated curves between mapped code symbols in the editor. Variable colors derive from symbol identity for any snippet, with optional scope-qualified IDs; each flow segment uses its own destination symbol’s color. Curves avoid symbol boxes and prefer routes without crossings. The review panel contains concise steps and symbol links without a separate flow diagram. The flow updates automatically when you select a step or use the arrow keys. Proposed fixes are explicitly labeled; abstract nodes never create fabricated code connections. Motion respects the system’s reduced-motion preference. Suggested code follows the steps. The popover shows only the finding for the clicked line. The backend supplies explanations and linked variable highlights for each snippet; click a variable reference to jump to its line. Editing clears the findings and closes the popover. Explanations, flows, illustrative values, and suggested edits come from the backend review; the frontend renders them without executing code. The main workspace contains a full-height code editor with an editable snippet name in its title bar. The collapsible sidebar lists your saved snippets and keeps the Reviewlet logo visible.

Create a snippet with **New snippet**, rename it in the title bar, and edit its code. Hover a sidebar snippet (or focus it with the keyboard) to reveal its red delete button. Deletions are saved locally, including an empty library. An empty library shows a landing page introducing intelligent code reviews, with an illustrative finding and suggested fix and buttons to create a blank snippet or try a prefilled demo. Edits autosave to the backend after five idle seconds, and also save when you leave a field or switch snippets. Saves use the latest draft; late responses do not replace editor contents. Snippets, reviews and finding decisions survive browser refreshes and server restarts. This is a single-user shared workspace; authentication and ownership are not implemented.

Review generation uses `src/api/reviews.ts`; `src/api/mock.ts` supplies deterministic fixtures only for tests. The review button and Command/Ctrl+Enter submit the current code, language hint, and optional context to the Go server, which forwards them to the configured provider. A failed review shows an error and allows retry; it never falls back to canned findings. Backend request IDs and retry delays appear in errors when available. Snippets, finding status/comments, and applied-fix revisions are saved in SQLite. Use **Dismiss finding** in the review panel to persist a dismissal and remove that finding from the active guide. Applying a fix persists its accepted status and remapped findings. AI discussion is not implemented. Syntax highlighting uses `web-tree-sitter` in-browser with locally bundled WASM grammars from `@vscode/tree-sitter-wasm`. JavaScript/JSX, TypeScript/TSX, Python and Go use syntax-tree queries, including error recovery for incomplete code. Grammars load on demand from the same origin; unknown languages or unavailable grammars display plain text. No regex tokenizer or injected highlighting HTML is used. Syntax captures are composed with the existing review highlights, sample values and inline fix preview. Language metadata is detected in-browser with highlight.js after a 350 ms typing pause, among JavaScript, TypeScript, Python and Go. Empty or low-evidence fragments remain `unknown`. Language changes update the editor and save to the backend; blur, switching snippets and review submission flush pending detection. The dropdown to the right of the snippet title defaults to **Auto**. Choosing JavaScript, TypeScript, Python or Go disables inference for that snippet and saves the override; choosing Auto re-detects the current code and enables inference again. The setting survives reloads.

For local development, keep both processes running in separate terminals:

```sh
# Terminal 1, repository root
export OPENAI_API_KEY="your-api-key"
make backend-run

# Terminal 2, repository root
cd frontend
npm run dev
```

Vite forwards `/api` to `http://localhost:8080`; OpenAI credentials stay in the backend environment. On first load, existing browser snippets and their real reviews/decisions are copied into the backend once; browser data is retained. Old mock findings are cleared during migration. **Try a demo** inserts a checkout-quote endpoint with SKU normalization, a catalog lookup, quantity maps, line totals, coupon discounts, and shipping. Its intended issues span several operations: user-supplied SKUs flow into SQL, repeated quantities are overwritten before totals are calculated, and a whole-number coupon percentage is used as a multiplier before the final total is clamped. The context includes a concrete cart and its expected 6,875-cent total, giving the reviewer values to trace through the intermediate variables. Findings still come from the same backend as every other snippet; the UI does not require a fixed count. Existing saved snippets are preserved.

## Backend

Requires Go 1.27 or newer. From the repository root, export your provider configuration and start the server:

```sh
export OPENAI_API_KEY="your-api-key"
make backend-run
```

`OPENAI_API_KEY` is required; missing or invalid configuration stops startup. The default model is `gpt-6.1-sol`, chosen for code review quality and cost; set `OPENAI_MODEL` to override it. The server reads environment variables directly and does not load `.env` files. See [`backend/.env.example`](backend/.env.example) for configuration:

| Variable                       | Default                     | Purpose                                                                 |
| ------------------------------ | --------------------------- | ----------------------------------------------------------------------- |
| `OPENAI_API_KEY`               | Required                    | Server-side provider credential                                         |
| `OPENAI_MODEL`                 | `gpt-6.1-sol`               | Model supporting Chat Completions Structured Outputs                    |
| `OPENAI_BASE_URL`              | `https://api.openai.com/v1` | OpenAI-compatible API base URL, including any version prefix            |
| `REVIEW_TIMEOUT`               | `90s`                       | Positive duration limiting the provider request and review processing   |
| `OPENAI_MAX_COMPLETION_TOKENS` | `16384`                     | Positive completion budget, including reasoning tokens where applicable |
| `LISTEN_ADDR`                  | `:8080`                     | HTTP listen address                                                     |
| `LOG_LEVEL`                    | `info`                      | Log threshold: `debug`, `info`, `warn`, or `error`                      |

The server registers `POST /api/v1/review`. The frontend development server proxies `/api` requests here, including the review button and its keyboard shortcut. To call the real backend directly (this sends the snippet to your configured provider):

```sh
curl http://localhost:8080/api/v1/review \
  -H 'Content-Type: application/json' \
  -d '{"code":"function first(items) { return items[0].name; }","language":"javascript","context":"items may be empty"}'
```

The service makes one non-streaming request to `<OPENAI_BASE_URL>/chat/completions` with `response_format.type: "json_schema"`, `json_schema.strict: true`, `reasoning_effort: "low"`, and `store: false`. It rejects incomplete, refused, oversized, or invalid provider output; it does not silently retry billable requests. [Structured Outputs constrains the response to the supplied schema](https://developers.openai.com/api/docs/guides/structured-outputs). The strict provider schema is derived from OpenAPI: all fields are required, optional features are nullable, and unsupported constraints remain enforced locally. Provider nulls for optional fields are omitted from the public response; explicit empty flow connections remain `[]`. The backend independently validates the provider shape and the complete API schema, then checks source references and edit semantics. Invalid or mismatched source ranges, UTF-16 symbol references, flow edges, duplicate identities, or inexact/oversized edits fail the entire review with a structured 502 error. The server assigns the review ID, UTC creation time, source hash, and finding order.

The review prompt lives in [`backend/internal/review/prompts/review.txt`](backend/internal/review/prompts/review.txt) and is embedded with `embed.FS`, along with the runtime schemas. The binary needs no prompt files or OpenAPI file at runtime. Source and context are supplied as untrusted JSON in a separate user message, with original code and numbered source lines. The prompt requests concise findings, explanation steps, source-linked flows for data-dependent bugs, helpful sample values, and exact edits; it instructs the model to review text without executing it.

Requests require JSON, have a 256 KiB body limit, and enforce the editor's 30,000 UTF-16-unit code limit. Errors use the contract's JSON envelope: 400 for invalid input, 413 for oversized bodies, 429 for provider rate limits, 502 for invalid reviews/provider requests, 503 for provider availability or authentication failures, and 504 for timeouts. Retry delays are normalized to integer seconds where supplied. Client cancellation stops the provider request. The server sets HTTP timeouts, disables response caching, and shuts down gracefully on SIGINT/SIGTERM. It does not log submitted code, model output, or provider error bodies.

The backend writes structured JSON logs to stderr using Go's `slog`. Startup/shutdown events include the listen address, selected model, and review timeout. Access logs include the method, matched route pattern, status, duration, and response size. Provider logs include model, upstream status, duration, and a safe failure-stage label; completed reviews include the review ID and finding count. `LOG_LEVEL` defaults to `info`; 4xx requests log at `warn`, and 5xx requests at `error`.

Each request receives a server-generated `X-Request-ID`. The same `request_id` appears in provider, review, and HTTP logs; JSON errors also return it as `error.requestId`. Submitted code/context, prompts, request headers, query strings, unmatched URL paths, API keys, model output, and provider error bodies are excluded from application logs.

Run `make backend-test` for tests covering the real HTTP route against local fake providers, configuration, schema validation, source mappings, edits, and cancellation. Tests need no API key or external LLM calls.

Backend linting uses golangci-lint, pinned in the root `.golangciversion` file, with configuration in `backend/.golangci.yml`. The standard linter set includes `govet`, and formatting uses `gofmt` and `goimports`. From the repository root:

```sh
make backend-check         # Run lint, formatting checks, and tests
make backend-lint          # Run golangci-lint
make backend-format-check  # Report formatting differences without changing files
make backend-format        # Apply formatting fixes
```

These targets automatically download the pinned binary to the ignored `backend/bin/` directory when it is missing or has the wrong version. The first run requires curl and network access; later runs reuse the binary. Change `.golangciversion` to upgrade the tool for both local checks and CI. This follows [NilAway's version-pinning approach](https://github.com/uber-go/nilaway/blob/main/Makefile).

### SQLite workspace

`DATABASE_PATH` defaults to `data/reviewlet.db`, relative to the server working directory (`backend/` with `make backend-run`). The server creates the directory, database and schema automatically using the pure-Go `modernc.org/sqlite` driver; no external SQLite installation is needed. SQLite files are ignored by Git. Set `DATABASE_PATH` to use another persistent location.

Each snippet has an immutable UUID (assigned by the frontend at creation and validated by the API), title, language, creation date, review status, code and optional context. Status is `draft`, `reviewing`, `reviewed`, `stale`, or `failed`. The versioned database stores nested review results, symbol flows, finding decisions, comments and fix revisions together as JSON snapshots, so each update is atomic. Renames preserve review state; manual source changes invalidate it. Interrupted reviews are marked failed when the server restarts.

| Endpoint                                           | Purpose                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /api/v1/snippets`                             | Load the saved workspace                                                 |
| `PUT /api/v1/snippets/{id}`                        | Create a UUID-addressed snippet or update its metadata/code              |
| `DELETE /api/v1/snippets/{id}`                     | Delete the snippet and its saved review                                  |
| `POST /api/v1/review` with `snippetId`             | Persist review progress, result and failures                             |
| `PATCH /api/v1/snippets/{id}/findings/{findingId}` | Accept, dismiss or reopen a finding in the specified review              |
| `PUT /api/v1/snippets/{id}/review-state`           | Save an applied fix or undo with updated finding locations and decisions |

Updates require the latest `expectedVersion`; fix revisions also require exact `expectedCode`. Conflicts return 409 rather than overwriting another tab's changes. Finding decisions include `reviewId` so a stale decision cannot affect a newer review. A late model response cannot overwrite edited or deleted source. Review requests without `snippetId` remain stateless. Workspace write requests are limited to 2 MiB. The frontend pulls the collection once at startup and then reads its in-memory workspace. Save and review responses update that cache directly; persisted review success/error responses include `snippetVersion` for subsequent writes. There is no collection polling or review-triggered collection refresh. Reloading the page explicitly pulls the latest saved workspace.

## API contract

[`api/openapi.yaml`](api/openapi.yaml) defines `POST /api/v1/review`. Send `code` with optional `language` and `context`; receive a synchronous review containing a source hash, a short summary, and structured findings. Findings include severity/category, source locations, concise explanations, symbol references, directional flows, optional illustrative values, and exact replacement edits for applicable fixes. Examples cover a SQL injection finding and a completed review with no findings.

Locations use one-based lines and UTF-16 columns, with exclusive end columns. The returned `codeHash` is SHA-256 of the exact submitted UTF-8 source, allowing clients to detect stale results. The contract also defines validation, rate-limit, and provider error responses. [`api/review-generation.md`](api/review-generation.md) provides guidance for generating examples and edits.

The Go handler and frontend review adapter use this contract. Generated bindings are ignored by Git and produced automatically:

- Go: `backend/internal/api/api.gen.go`, using `oapi-codegen` v2.8.0 (pinned as a Go tool in `backend/go.mod`). Includes models, standard `net/http` routes, and the typed `StrictServerInterface`.
- Runtime validation: `backend/internal/api/schema.gen.json`, extracted from the same OpenAPI schemas and embedded into the server.
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

Frontend callers can import `reviewSnippet` and request/response types from `frontend/src/api/client.ts`. The client uses the page's origin, including Vite's `/api` proxy during development. Calls return typed `data` or `error` with the HTTP response; callers still need to handle network errors. The UI uses this client through `src/api/reviews.ts`, verifies the returned source hash, preserves the server review metadata and full guides, and maps severities into editor highlights. Out-of-date or superseded results are rejected before saving.

The review service implements the generated `api.StrictServerInterface`; generated routes handle JSON binding and response serialization. An HTTP wrapper enforces body limits and request schema validation before binding.

## Checks

After installing frontend dependencies with `cd frontend && npm ci`, run from the repository root:

```sh
make check
```

This always generates API bindings and runs frontend linting, formatting checks, tests, type-checking, and a production build, plus golangci-lint, formatting checks, and `go test` for the backend.
Use `make frontend-check` or `make backend-check` to run either component separately.

Enable the pre-push hook once per checkout:

```sh
make install-hooks
```

The hook runs `make check` before every push and blocks the push if any check fails. Frontend dependencies must be installed, and Node.js, npm, Go, Make, and curl must be available on your PATH. Hook installation sets this checkout's `core.hooksPath` to the versioned `.githooks/` directory.

GitHub Actions runs these same targets in separate frontend and backend workflows on pull requests and pushes to `main`. The backend workflow ignores changes under `frontend/`, Markdown files at any depth, and the root `LICENSE` and `.gitignore` files; the frontend workflow ignores `backend/`, Markdown files, `LICENSE`, and `.gitignore`. Each workflow runs if any changed file falls outside its ignored paths. Either workflow can also be started manually from the Actions tab.
