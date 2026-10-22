package api

import (
	"slices"
	"strings"
)

// structuredSchema adapts OpenAPI schemas to the strict Structured Outputs
// subset. Unsupported limits remain enforced by the original runtime schema.
func structuredSchema(schema map[string]any) map[string]any {
	result := map[string]any{}
	for _, key := range []string{"type", "enum", "description", "pattern", "format", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems"} {
		if value, ok := schema[key]; ok {
			result[key] = value
		}
	}
	if reference, ok := schema["$ref"].(string); ok {
		result["$ref"] = strings.Replace(reference, "#/components/schemas/", "#/$defs/", 1)
	}
	if items, ok := schema["items"].(map[string]any); ok {
		result["items"] = structuredSchema(items)
	}
	if properties, ok := schema["properties"].(map[string]any); ok {
		originalRequired := map[string]bool{}
		fields, _ := schema["required"].([]any)
		for _, field := range fields {
			originalRequired[field.(string)] = true
		}
		converted := map[string]any{}
		required := make([]string, 0, len(properties))
		for field, value := range properties {
			property := structuredSchema(value.(map[string]any))
			if !originalRequired[field] {
				property = map[string]any{"anyOf": []any{property, map[string]any{"type": "null"}}}
			}
			converted[field] = property
			required = append(required, field)
		}
		slices.Sort(required)
		result["properties"] = converted
		result["required"] = required
		result["additionalProperties"] = false
	}
	return result
}
