package review

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/yuxincs/reviewlet/backend/internal/api"
)

func TestCompactReviewRestoresPublicContract(t *testing.T) {
	request, _, rich := exampleReview(t)
	contract, err := api.LoadContract()
	if err != nil {
		t.Fatal(err)
	}
	compact := structuredFixture(t, rich)
	result, err := decodeStructuredReview(compact, request.Code, contract)
	if err != nil {
		t.Fatal(err)
	}
	var expected modelReview
	if err := json.Unmarshal(rich, &expected); err != nil {
		t.Fatal(err)
	}
	for i := range expected.Findings {
		expected.Findings[i].Id = result.Findings[i].Id
		if edit := expected.Findings[i].Edit; edit != nil {
			expected.Findings[i].Fix = edit.Replacement
		}
	}
	if !reflect.DeepEqual(result, expected) {
		t.Fatal("compact output lost locations, flows, sample values or fixes")
	}
	t.Logf("API fixture: %d bytes; compact provider output: %d bytes", len(rich), len(compact))
}

func BenchmarkDecodeStructuredReview(b *testing.B) {
	request, _, rich := exampleReview(b)
	contract, err := api.LoadContract()
	if err != nil {
		b.Fatal(err)
	}
	compact := structuredFixture(b, rich)
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if _, err := decodeStructuredReview(compact, request.Code, contract); err != nil {
			b.Fatal(err)
		}
	}
}

func TestCompactReferenceColumnResolution(t *testing.T) {
	contract, err := api.LoadContract()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, code, symbol string
		column             any
		wantStart          int
		valid              bool
	}{
		{"unicode and tabs", "😀\tconst value = 1;\r", "value", nil, 10, true},
		{"identifier suffix is not an occurrence", "  const totalCents = discountedSubtotalCents + shippingCents;", "totalCents", nil, 9, true},
		{"unicode identifier boundary", "πvalue + value;", "value", nil, 10, true},
		{"only embedded substring", "const myvalue = 1;", "value", nil, 0, false},
		{"identifier prefix is not an occurrence", "const value = valueCopy;", "value", nil, 7, true},
		{"member and variable are still ambiguous", "return db.query(query);", "query", nil, 0, false},
		{"ambiguous", "use(value, value)", "value", nil, 0, false},
		{"explicit second occurrence", "use(value, value)", "value", 12, 12, true},
		{"missing", "const other = 1;", "value", nil, 0, false},
		{"wrong explicit column", "const value = 1;", "value", 1, 0, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data, _ := json.Marshal(map[string]any{
				"language": "javascript", "summary": "Example.", "findings": []any{map[string]any{
					"summary": "Example finding", "description": "Follow `value`.", "severity": "warning", "category": "bug", "lineStart": 1, "lineEnd": 1, "fix": "", "edit": nil,
					"steps": []any{map[string]any{"description": "Follow `value`.", "flow": nil, "links": []any{map[string]any{
						"symbolId": "scope:value", "symbol": tc.symbol, "line": 1, "startColumn": tc.column, "role": "source",
					}}}},
				}},
			})
			result, err := decodeStructuredReview(data, tc.code, contract)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%t, want %t", err == nil, tc.valid)
			}
			if tc.valid {
				ref := (*result.Findings[0].Steps[0].Links)[0]
				if ref.StartColumn != tc.wantStart || ref.EndColumn != tc.wantStart+codeUnits(tc.symbol) {
					t.Fatalf("wrong columns: %d-%d", ref.StartColumn, ref.EndColumn)
				}
			}
		})
	}
}
