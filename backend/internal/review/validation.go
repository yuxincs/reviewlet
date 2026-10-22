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
	return normalizeReview(result, code, contract)
}

// Normalize deterministic source fields before enforcing the public contract.
// Alternate provider representations use the same source/edit validation.
func normalizeReview(result modelReview, code string, contract *api.Contract) (modelReview, error) {
	lines := strings.Split(code, "\n")
	completeReference := func(reference *api.SymbolReference) bool {
		if reference != nil {
			if reference.StartColumn == 0 {
				if !validRange(reference.Line, reference.Line, len(lines)) || reference.Symbol == "" {
					return false
				}
				line := lines[reference.Line-1]
				position, unique := uniqueSymbolPosition(line, reference.Symbol)
				if !unique {
					return false
				}
				reference.StartColumn = codeUnits(line[:position]) + 1
			}
			reference.EndColumn = reference.StartColumn + codeUnits(reference.Symbol)
		}
		return true
	}
	for i := range result.Findings {
		finding := &result.Findings[i]
		finding.Id = fmt.Sprintf("f%d", i+1)
		if edit := finding.Edit; edit != nil {
			if !validRange(edit.StartLine, edit.EndLine, len(lines)) {
				return modelReview{}, failedReview()
			}
			edit.Original = strings.Join(lines[edit.StartLine-1:edit.EndLine], "\n")
			finding.Fix = edit.Replacement
		}
		for j := range finding.Steps {
			step := &finding.Steps[j]
			if step.Links != nil {
				for k := range *step.Links {
					if !completeReference(&(*step.Links)[k]) {
						return modelReview{}, failedReview()
					}
				}
			}
			if step.Flow != nil {
				for k := range step.Flow.Nodes {
					if !completeReference(step.Flow.Nodes[k].Reference) {
						return modelReview{}, failedReview()
					}
				}
			}
		}
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

// An identifier inside a longer identifier is not a second occurrence of the
// referenced binding (e.g. totalCents within discountedSubtotalCents). Explicit
// columns can still select any exact substring; this only resolves null columns.
func uniqueSymbolPosition(line, symbol string) (int, bool) {
	if symbol == "" {
		return 0, false
	}
	identifierPart := func(r rune) bool {
		return r == '_' || r == '$' || r == '\u200c' || r == '\u200d' || unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsMark(r)
	}
	first, _ := utf8.DecodeRuneInString(symbol)
	last, _ := utf8.DecodeLastRuneInString(symbol)
	found := -1
	for offset := 0; offset <= len(line)-len(symbol); {
		relative := strings.Index(line[offset:], symbol)
		if relative < 0 {
			break
		}
		start := offset + relative
		end := start + len(symbol)
		offset = start + 1
		if start > 0 && identifierPart(first) {
			previous, _ := utf8.DecodeLastRuneInString(line[:start])
			if identifierPart(previous) {
				continue
			}
		}
		if end < len(line) && identifierPart(last) {
			next, _ := utf8.DecodeRuneInString(line[end:])
			if identifierPart(next) {
				continue
			}
		}
		if found >= 0 {
			return 0, false
		}
		found = start
	}
	return found, found >= 0
}
