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
