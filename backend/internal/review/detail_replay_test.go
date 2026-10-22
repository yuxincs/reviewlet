package review

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"github.com/yuxincs/reviewlet/backend/internal/api"
)

// Replay saved private audit data locally after source-resolver changes. This
// test never contacts the provider or changes recorded generation timings.
func TestReplayDetailAudit(t *testing.T) {
	path := os.Getenv("REVIEWLET_DETAIL_REPLAY")
	if path == "" {
		t.Skip("set REVIEWLET_DETAIL_REPLAY to revalidate saved outputs locally")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var audits []struct {
		Round   int          `json:"round"`
		Variant string       `json:"variant"`
		Review  *modelReview `json:"review"`
		Raw     []string     `json:"providerOutput"`
	}
	if json.Unmarshal(data, &audits) != nil {
		t.Fatal("invalid audit file")
	}
	inputData, err := os.ReadFile(os.Getenv("REVIEWLET_BENCHMARK_INPUT"))
	if err != nil {
		t.Fatal(err)
	}
	var input api.ReviewRequest
	if json.Unmarshal(inputData, &input) != nil {
		t.Fatal("invalid input")
	}
	contract, err := api.LoadContract()
	if err != nil {
		t.Fatal(err)
	}
	_, tableSchema, err := detailTableSchema(contract)
	if err != nil {
		t.Fatal(err)
	}
	var targets []api.ReviewFinding
	for _, audit := range audits {
		if audit.Review != nil {
			targets = audit.Review.Findings
			break
		}
	}
	if len(targets) == 0 {
		t.Fatal("no preserved target metadata")
	}
	for _, audit := range audits {
		valid := 0
		merged := modelReview{Language: "unknown", Summary: "Revalidated details.", Findings: []api.ReviewFinding{}}
		for i, raw := range audit.Raw {
			if i >= len(targets) {
				t.Fatal("target count mismatch")
			}
			var result modelReview
			var err error
			if audit.Variant == "table-sol" || audit.Variant == "table-luna" {
				language := "unknown"
				if input.Language != nil {
					language = *input.Language
				}
				result, err = decodeTableDetail([]byte(raw), input.Code, language, targets[i], contract, tableSchema)
			} else {
				result, err = decodeStructuredReview([]byte(raw), input.Code, contract)
			}
			if err == nil && len(result.Findings) == 1 {
				valid++
				finding := result.Findings[0]
				finding.Id = fmt.Sprintf("f%d", i+1)
				forEachLiveReference(&finding, func(ref *api.SymbolReference) { ref.SymbolId = fmt.Sprintf("d%d:%s", i, ref.SymbolId) })
				merged.Findings = append(merged.Findings, finding)
				merged.Language = result.Language
			}
		}
		t.Logf("round=%d variant=%s valid_details_after_resolver_fix=%d/%d", audit.Round, audit.Variant, valid, len(audit.Raw))
		if valid != len(audit.Raw) {
			t.Errorf("saved responses still contain invalid details")
		} else {
			unifyLiveIdentities(merged.Findings)
			encoded, _ := json.Marshal(merged)
			if _, err := validateModel(encoded, input.Code, contract); err != nil {
				t.Error("saved details failed combined validation")
			}
		}
	}
}
