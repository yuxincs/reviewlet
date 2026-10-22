package api

import (
	"bytes"
	"embed"
	"fmt"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

//go:embed schema.gen.json
var schemaFS embed.FS

// Contract validates wire data using schemas generated from OpenAPI.
type Contract struct {
	Request  *jsonschema.Schema
	Model    *jsonschema.Schema
	Response *jsonschema.Schema
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
	return contract, nil
}
