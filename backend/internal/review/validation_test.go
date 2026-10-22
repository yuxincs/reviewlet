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
			Flow: &api.DataFlow{Kind: api.Current, Nodes: []api.FlowNode{{Label: "source", Reference: &first}, {Label: "sink", Reference: &second}}},
		}}, Edit: &api.CodeEdit{StartLine: 1, EndLine: 1, Original: "😀\tconst x = 1;\r", Replacement: ""},
	}}}
	data, _ := json.Marshal(model)
	if _, err := validateModel(data, code, contract); err != nil {
		t.Fatal("valid UTF-16 references and exact CRLF edit rejected", err)
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
