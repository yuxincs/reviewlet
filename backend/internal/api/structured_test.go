package api

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestStructuredSchemaCompatibility(t *testing.T) {
	contract, err := LoadContract()
	if err != nil {
		t.Fatal(err)
	}
	var root map[string]any
	if err := json.Unmarshal([]byte(contract.ModelJSON), &root); err != nil {
		t.Fatal(err)
	}
	if root["type"] != "object" || root["anyOf"] != nil || root["components"] != nil {
		t.Fatal("provider schema must have an object root")
	}
	allowed := map[string]bool{}
	for _, key := range strings.Fields("type enum description pattern format minimum maximum exclusiveMinimum exclusiveMaximum multipleOf minItems maxItems $ref $defs properties required additionalProperties items anyOf") {
		allowed[key] = true
	}
	var check func(map[string]any)
	check = func(schema map[string]any) {
		for key := range schema {
			if !allowed[key] {
				t.Errorf("unsupported provider keyword: %s", key)
			}
		}
		if ref, ok := schema["$ref"].(string); ok && !strings.HasPrefix(ref, "#/$defs/") {
			t.Errorf("invalid reference: %s", ref)
		}
		if properties, ok := schema["properties"].(map[string]any); ok {
			required := map[string]bool{}
			for _, value := range schema["required"].([]any) {
				required[value.(string)] = true
			}
			if len(required) != len(properties) || schema["additionalProperties"] != false {
				t.Error("strict object must require every property and disallow extras")
			}
			for key, property := range properties {
				if !required[key] {
					t.Errorf("optional provider property: %s", key)
				}
				check(property.(map[string]any))
			}
		}
		if items, ok := schema["items"].(map[string]any); ok {
			check(items)
		}
		if variants, ok := schema["anyOf"].([]any); ok {
			for _, variant := range variants {
				check(variant.(map[string]any))
			}
		}
		if definitions, ok := schema["$defs"].(map[string]any); ok {
			for _, definition := range definitions {
				check(definition.(map[string]any))
			}
		}
	}
	check(root)
	definitions := root["$defs"].(map[string]any)
	if definitions["ReviewResponse"] != nil || definitions["ErrorResponse"] != nil {
		t.Fatal("server metadata or error schemas leaked into provider shape")
	}
	finding := definitions["ReviewFinding"].(map[string]any)["properties"].(map[string]any)
	edit := finding["edit"].(map[string]any)["anyOf"].([]any)
	if edit[0].(map[string]any)["$ref"] != "#/$defs/CodeEdit" || edit[1].(map[string]any)["type"] != "null" {
		t.Fatal("optional edit must be nullable")
	}
}
