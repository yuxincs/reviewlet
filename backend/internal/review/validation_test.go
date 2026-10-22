package review

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/yuxincs/reviewlet/backend/internal/api"
)

func TestInvalidModelReferencesAndEdits(t *testing.T) {
	request, _, data := exampleReview(t)
	contract, err := api.LoadContract()
	if err != nil {
		t.Fatal(err)
	}
	tests := map[string]func(*modelReview){
		"unknown severity":             func(m *modelReview) { m.Findings[0].Severity = "high" },
		"unknown category":             func(m *modelReview) { m.Findings[0].Category = "correctness" },
		"duplicate IDs":                func(m *modelReview) { m.Findings = append(m.Findings, m.Findings[0]) },
		"blank description":            func(m *modelReview) { m.Findings[0].Description = " " },
		"multiline title":              func(m *modelReview) { m.Findings[0].Summary = "title\nextra" },
		"no steps":                     func(m *modelReview) { m.Findings[0].Steps = []api.ExplanationStep{} },
		"blank step":                   func(m *modelReview) { m.Findings[0].Steps[0].Description = " " },
		"out of bounds":                func(m *modelReview) { m.Findings[0].LineEnd = 999 },
		"inverted range":               func(m *modelReview) { m.Findings[0].LineStart = 4; m.Findings[0].LineEnd = 1 },
		"reference mismatch":           func(m *modelReview) { (*m.Findings[0].Steps[0].Links)[0].Symbol = "wrong" },
		"reference line":               func(m *modelReview) { (*m.Findings[0].Steps[0].Links)[0].Line = 999 },
		"reference start":              func(m *modelReview) { (*m.Findings[0].Steps[0].Links)[0].StartColumn = 0 },
		"reference end":                func(m *modelReview) { (*m.Findings[0].Steps[0].Links)[0].EndColumn = 999 },
		"reference reversed":           func(m *modelReview) { (*m.Findings[0].Steps[0].Links)[0].EndColumn = 2 },
		"same occurrence new identity": func(m *modelReview) { m.Findings[0].Steps[0].Flow.Nodes[0].Reference.SymbolId = "different" },
		"same identity distinct member": func(m *modelReview) {
			flow := m.Findings[0].Steps[1].Flow
			flow.Nodes[len(flow.Nodes)-1].Reference.SymbolId = flow.Nodes[0].Reference.SymbolId
		},
		"flow too short":          func(m *modelReview) { m.Findings[0].Steps[0].Flow.Nodes = m.Findings[0].Steps[0].Flow.Nodes[:1] },
		"flow reference mismatch": func(m *modelReview) { m.Findings[0].Steps[0].Flow.Nodes[0].Reference.Symbol = "wrong" },
		"flow edge bounds": func(m *modelReview) {
			edges := []api.FlowConnection{{From: 0, To: 999}}
			m.Findings[0].Steps[0].Flow.Connections = &edges
		},
		"flow negative edge": func(m *modelReview) {
			edges := []api.FlowConnection{{From: -1, To: 1}}
			m.Findings[0].Steps[0].Flow.Connections = &edges
		},
		"flow self edge": func(m *modelReview) {
			edges := []api.FlowConnection{{From: 0, To: 0}}
			m.Findings[0].Steps[0].Flow.Connections = &edges
		},
		"flow duplicate edges": func(m *modelReview) {
			edges := []api.FlowConnection{{From: 0, To: 1}, {From: 0, To: 1}}
			m.Findings[0].Steps[0].Flow.Connections = &edges
		},
		"edit source mismatch": func(m *modelReview) { m.Findings[0].Edit.Original = "wrong" },
		"edit range":           func(m *modelReview) { m.Findings[0].Edit.EndLine = 999 },
		"edit inverted range":  func(m *modelReview) { m.Findings[0].Edit.StartLine = 4; m.Findings[0].Edit.EndLine = 1 },
		"edit UTF16 limit":     func(m *modelReview) { m.Findings[0].Edit.Replacement = strings.Repeat("😀", 15001) },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			var model modelReview
			if err := json.Unmarshal(data, &model); err != nil {
				t.Fatal(err)
			}
			mutate(&model)
			changed, err := json.Marshal(model)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := validateModel(changed, request.Code, contract); err == nil {
				t.Fatal("invalid model review accepted")
			}
		})
	}
}

func TestUTF16ReferencesAndCRLFEdits(t *testing.T) {
	contract, err := api.LoadContract()
	if err != nil {
		t.Fatal(err)
	}
	code := "😀\tconst x = 1;\r\nreturn x;"
	first := api.SymbolReference{SymbolId: "scope:x", Symbol: "x", Line: 1, StartColumn: 10, EndColumn: 11, Role: api.Source}
	second := api.SymbolReference{SymbolId: "scope:x", Symbol: "x", Line: 2, StartColumn: 8, EndColumn: 9, Role: api.Sink}
	links := []api.SymbolReference{first, second}
	model := modelReview{Language: "javascript", Summary: "Example.", Findings: []api.ReviewFinding{{
		Id: "example", Summary: "Example finding", Description: "An example involving `x`.", Severity: api.Warning, Category: api.Bug,
		LineStart: 1, LineEnd: 2, Fix: "", Steps: []api.ExplanationStep{{Description: "Follow `x`.", Links: &links,
			Flow: &api.DataFlow{Kind: api.DataFlowKindCurrent, Nodes: []api.FlowNode{{Label: "source", Reference: &first}, {Label: "sink", Reference: &second}}},
		}}, Edit: &api.CodeEdit{StartLine: 1, EndLine: 1, Original: "😀\tconst x = 1;\r", Replacement: ""},
	}}}
	data, _ := json.Marshal(model)
	if _, err := validateModel(data, code, contract); err != nil {
		t.Fatal("valid UTF-16 references and exact CRLF edit rejected", err)
	}
	if _, err := decodeStructuredReview(structuredFixture(t, data), code, contract); err != nil {
		t.Fatal("compact output failed to reconstruct UTF-16 columns and CRLF source", err)
	}
	model.Findings[0].Edit.Original = "😀\tconst x = 1;"
	data, _ = json.Marshal(model)
	if _, err := validateModel(data, code, contract); err == nil {
		t.Fatal("normalized CRLF edit accepted")
	}
	model.Findings[0].Edit = nil
	(*model.Findings[0].Steps[0].Links)[0].StartColumn = 9
	data, _ = json.Marshal(model)
	if _, err := validateModel(data, code, contract); err == nil {
		t.Fatal("rune-based column accepted as UTF-16")
	}
}

func TestRequestUTF16Boundary(t *testing.T) {
	contract, err := api.LoadContract()
	if err != nil {
		t.Fatal(err)
	}
	for _, code := range []string{strings.Repeat("x", 30000), strings.Repeat("😀", 15000)} {
		data, _ := json.Marshal(api.ReviewRequest{Code: code})
		if err := validateRequest(data, contract); err != nil {
			t.Fatal("30,000 UTF-16 units rejected", err)
		}
	}
}

func TestStructuredOutputNormalization(t *testing.T) {
	request, _, canonical := exampleReview(t)
	contract, err := api.LoadContract()
	if err != nil {
		t.Fatal(err)
	}
	structured := structuredFixture(t, canonical)
	for _, explicitEmpty := range []bool{false, true} {
		t.Run(map[bool]string{false: "null connections", true: "empty connections"}[explicitEmpty], func(t *testing.T) {
			var raw map[string]any
			if err := json.Unmarshal(structured, &raw); err != nil {
				t.Fatal(err)
			}
			finding := raw["findings"].([]any)[0].(map[string]any)
			finding["edit"] = nil
			step := finding["steps"].([]any)[0].(map[string]any)
			step["links"] = nil
			flow := step["flow"].(map[string]any)
			flow["connections"] = nil
			if explicitEmpty {
				flow["connections"] = []any{}
			}
			node := flow["nodes"].([]any)[0].(map[string]any)
			node["reference"], node["sampleValue"] = nil, nil
			data, _ := json.Marshal(raw)
			result, err := decodeStructuredReview(data, request.Code, contract)
			if err != nil {
				t.Fatal(err)
			}
			actual := result.Findings[0]
			if actual.Edit != nil || actual.Steps[0].Links != nil || actual.Steps[0].Flow.Nodes[0].Reference != nil || actual.Steps[0].Flow.Nodes[0].SampleValue != nil {
				t.Fatal("nullable optional fields were not normalized")
			}
			edges := actual.Steps[0].Flow.Connections
			if explicitEmpty && (edges == nil || len(*edges) != 0) {
				t.Fatal("explicit empty edges must remain distinct from default adjacency")
			}
			if !explicitEmpty && edges != nil {
				t.Fatal("null edges must select default adjacency")
			}
			encoded, _ := json.Marshal(result)
			if err := validateJSON(encoded, contract.Model); err != nil {
				t.Fatal("normalized response violates API schema", err)
			}
		})
	}
}

func TestStructuredOutputStillEnforcesAPIConstraints(t *testing.T) {
	request, _, canonical := exampleReview(t)
	contract, err := api.LoadContract()
	if err != nil {
		t.Fatal(err)
	}
	structured := structuredFixture(t, canonical)
	tests := map[string]func(map[string]any){
		"missing nullable field": func(f map[string]any) { delete(f, "edit") },
		"required null":          func(f map[string]any) { f["summary"] = nil },
		"oversized title":        func(f map[string]any) { f["summary"] = strings.Repeat("x", 161) },
		"duplicate edges": func(f map[string]any) {
			flow := f["steps"].([]any)[0].(map[string]any)["flow"].(map[string]any)
			flow["connections"] = []any{map[string]any{"from": 0, "to": 1}, map[string]any{"from": 0, "to": 1}}
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			var raw map[string]any
			if err := json.Unmarshal(structured, &raw); err != nil {
				t.Fatal(err)
			}
			mutate(raw["findings"].([]any)[0].(map[string]any))
			data, _ := json.Marshal(raw)
			if _, err := decodeStructuredReview(data, request.Code, contract); err == nil {
				t.Fatal("invalid provider review accepted")
			}
		})
	}
}
