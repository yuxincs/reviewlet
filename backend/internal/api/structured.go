package api

import (
	"slices"
	"strings"
)

// The provider generates only information that cannot be derived from source.
// review.decodeStructuredReview restores the complete public representation.
func compactReviewSchema(definitions map[string]any) {
	remove := func(name, field string) {
		schema := definitions[name].(map[string]any)
		delete(schema["properties"].(map[string]any), field)
		schema["required"] = slices.DeleteFunc(schema["required"].([]string), func(value string) bool { return value == field })
	}
	remove("ReviewFinding", "id")
	remove("ReviewFinding", "detailStatus")
	remove("ReviewFinding", "detailError")
	remove("SymbolReference", "endColumn")
	remove("CodeEdit", "original")
	reference := definitions["SymbolReference"].(map[string]any)["properties"].(map[string]any)
	reference["startColumn"] = map[string]any{
		"anyOf":       []any{reference["startColumn"], map[string]any{"type": "null"}},
		"description": "Use null for one matching identifier/expression occurrence on the source line; matches embedded in longer identifiers do not count. Supply a one-based UTF-16 column when multiple occurrences remain.",
	}
	finding := definitions["ReviewFinding"].(map[string]any)["properties"].(map[string]any)
	finding["fix"] = map[string]any{
		"anyOf":       []any{map[string]any{"type": "string"}, map[string]any{"type": "null"}},
		"description": "Illustrative code only when edit is null. When edit is present, use null; the server uses edit.replacement as the fix.",
	}
	edit := definitions["CodeEdit"].(map[string]any)
	edit["description"] = "A complete contiguous line replacement against submitted source. Preserve indentation and unrelated behavior. The server copies original from these source lines. Empty replacement deletes the range."
}

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
