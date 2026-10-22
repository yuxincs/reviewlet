package api

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

//go:embed schema.gen.json
var schemaFS embed.FS

// Contract validates wire data using schemas generated from OpenAPI.
type Contract struct {
	Request    *jsonschema.Schema
	Model      *jsonschema.Schema
	Structured *jsonschema.Schema
	Response   *jsonschema.Schema
	ModelJSON  string
}

func LoadContract() (*Contract, error) {
	data, err := schemaFS.ReadFile("schema.gen.json")
	if err != nil {
		return nil, err
	}
	document, err := jsonschema.UnmarshalJSON(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	compiler := jsonschema.NewCompiler()
	compiler.AssertFormat()
	const resource = "https://reviewlet.local/schema.json"
	if err := compiler.AddResource(resource, document); err != nil {
		return nil, err
	}
	contract := &Contract{}
	for name, destination := range map[string]**jsonschema.Schema{
		"ReviewRequest": &contract.Request, "ModelReview": &contract.Model, "ReviewResponse": &contract.Response,
	} {
		*destination, err = compiler.Compile(resource + "#/components/schemas/" + name)
		if err != nil {
			return nil, fmt.Errorf("compile %s: %w", name, err)
		}
	}
	// Adapt only review-related schemas for the provider's strict subset.
	var root struct {
		Components struct {
			Schemas map[string]map[string]any `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(data, &root); err != nil {
		return nil, err
	}
	schemas := root.Components.Schemas
	definitions := map[string]any{}
	for name, schema := range schemas {
		switch name {
		case "ReviewRequest", "ReviewResponse", "ErrorResponse", "ModelReview":
			continue
		}
		definitions[name] = structuredSchema(schema)
	}
	output := structuredSchema(schemas["ModelReview"])
	output["$defs"] = definitions
	modelJSON, err := json.Marshal(output)
	if err != nil {
		return nil, err
	}
	contract.ModelJSON = string(modelJSON)
	structured, err := jsonschema.UnmarshalJSON(bytes.NewReader(modelJSON))
	if err != nil {
		return nil, err
	}
	const modelResource = "https://reviewlet.local/structured.json"
	if err := compiler.AddResource(modelResource, structured); err != nil {
		return nil, err
	}
	contract.Structured, err = compiler.Compile(modelResource)
	if err != nil {
		return nil, fmt.Errorf("compile structured review: %w", err)
	}
	return contract, nil
}
