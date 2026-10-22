package review

import (
	"bytes"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/yuxincs/reviewlet/backend/internal/api"
)

const maxCodeUnits = 30000

type modelReview struct {
	Language string              `json:"language"`
	Summary  string              `json:"summary"`
	Findings []api.ReviewFinding `json:"findings"`
}

func nonblank(value string) bool {
	return strings.TrimFunc(value, func(r rune) bool { return unicode.IsSpace(r) || r == '\uFEFF' }) != ""
}

func codeUnits(value string) int { return len(utf16.Encode([]rune(value))) }

func validateJSON(data []byte, schema *jsonschema.Schema) error {
	if !utf8.Valid(data) {
		return fmt.Errorf("invalid UTF-8")
	}
	value, err := jsonschema.UnmarshalJSON(bytes.NewReader(data))
	if err != nil {
		return err
	}
	return schema.Validate(value)
}

func validateRequest(data []byte, contract *api.Contract) error {
	if err := validateJSON(data, contract.Request); err != nil {
		return invalidRequest()
	}
	var request api.ReviewRequest
	if err := json.Unmarshal(data, &request); err != nil {
		return invalidRequest()
	}
	if !nonblank(request.Code) || codeUnits(request.Code) > maxCodeUnits {
		return invalidRequest()
	}
	return nil
}

// decodeStructuredReview validates the provider format before normalizing nullable
// optional fields to the API's omitted-field convention. Explicit [] is preserved.
func decodeStructuredReview(data []byte, code string, contract *api.Contract) (modelReview, error) {
	if err := validateJSON(data, contract.Structured); err != nil {
		return modelReview{}, failedReview()
	}
	var result modelReview
	if err := json.Unmarshal(data, &result); err != nil {
		return modelReview{}, failedReview()
	}
	normalized, err := json.Marshal(result)
	if err != nil {
		return modelReview{}, failedReview()
	}
	return validateModel(normalized, code, contract)
}

func validateModel(data []byte, code string, contract *api.Contract) (modelReview, error) {
	var result modelReview
	if err := validateJSON(data, contract.Model); err != nil {
		return result, failedReview()
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return modelReview{}, failedReview()
	}
	if !nonblank(result.Language) || !nonblank(result.Summary) {
		return modelReview{}, failedReview()
	}
	lines := strings.Split(code, "\n")
	ids := map[string]bool{}
	symbols := map[string]string{}
	occurrences := map[[3]int]string{}
	referenceValid := func(reference api.SymbolReference) bool {
		if !nonblank(reference.SymbolId) || !validRange(reference.Line, reference.Line, len(lines)) {
			return false
		}
		line := utf16.Encode([]rune(lines[reference.Line-1]))
		start, end := reference.StartColumn-1, reference.EndColumn-1
		if start < 0 || end <= start || end > len(line) || !slices.Equal(line[start:end], utf16.Encode([]rune(reference.Symbol))) {
			return false
		}
		if symbol, exists := symbols[reference.SymbolId]; exists && symbol != reference.Symbol {
			return false
		}
		position := [3]int{reference.Line, reference.StartColumn, reference.EndColumn}
		if id, exists := occurrences[position]; exists && id != reference.SymbolId {
			return false
		}
		symbols[reference.SymbolId] = reference.Symbol
		occurrences[position] = reference.SymbolId
		return true
	}
	for _, finding := range result.Findings {
		if !nonblank(finding.Id) || ids[finding.Id] || !validRange(finding.LineStart, finding.LineEnd, len(lines)) || !nonblank(finding.Summary) || strings.ContainsAny(finding.Summary, "\r\n") || !nonblank(finding.Description) {
			return modelReview{}, failedReview()
		}
		ids[finding.Id] = true
		for _, step := range finding.Steps {
			if !nonblank(step.Description) {
				return modelReview{}, failedReview()
			}
			if step.Links != nil {
				for _, reference := range *step.Links {
					if !referenceValid(reference) {
						return modelReview{}, failedReview()
					}
				}
			}
			if step.Flow != nil {
				for _, node := range step.Flow.Nodes {
					if !nonblank(node.Label) || (node.Reference != nil && !referenceValid(*node.Reference)) {
						return modelReview{}, failedReview()
					}
				}
				if step.Flow.Connections != nil {
					for _, edge := range *step.Flow.Connections {
						if edge.From == edge.To || edge.From >= len(step.Flow.Nodes) || edge.To >= len(step.Flow.Nodes) {
							return modelReview{}, failedReview()
						}
					}
				}
			}
		}
		if edit := finding.Edit; edit != nil {
			if !validRange(edit.StartLine, edit.EndLine, len(lines)) || strings.Join(lines[edit.StartLine-1:edit.EndLine], "\n") != edit.Original {
				return modelReview{}, failedReview()
			}
			replacement := []string{}
			if edit.Replacement != "" {
				replacement = strings.Split(edit.Replacement, "\n")
			}
			updated := append(slices.Clone(lines[:edit.StartLine-1]), replacement...)
			updated = append(updated, lines[edit.EndLine:]...)
			if codeUnits(strings.Join(updated, "\n")) > maxCodeUnits {
				return modelReview{}, failedReview()
			}
		}
	}
	return result, nil
}

func validRange(start, end, total int) bool { return start >= 1 && end >= start && end <= total }
