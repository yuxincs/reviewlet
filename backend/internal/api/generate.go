// Package api contains HTTP server bindings generated from api/openapi.yaml.
package api

//go:generate go tool oapi-codegen --config oapi-codegen.yaml -o api.gen.go ../../../api/openapi.yaml
//go:generate go run ../cmd/apischema ../../../api/openapi.yaml schema.gen.json
