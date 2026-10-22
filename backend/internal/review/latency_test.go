package review

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/yuxincs/reviewlet/backend/internal/api"
)

func TestFanoutStartsDetailsTogetherAndMergesIdentities(t *testing.T) {
	request, _, fixture := exampleReview(t)
	contract, err := api.LoadContract()
	if err != nil {
		t.Fatal(err)
	}
	messages, err := reviewMessages(request)
	if err != nil {
		t.Fatal(err)
	}
	var active, peak atomic.Int32
	ready := make(chan struct{})
	var release sync.Once
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Messages []message `json:"messages"`
		}
		if json.NewDecoder(r.Body).Decode(&payload) != nil {
			w.WriteHeader(400)
			return
		}
		if len(payload.Messages) == 2 {
			_, _ = w.Write(completion([]byte(`{"findings":[{"summary":"First","severity":"critical","category":"security","lineStart":2,"lineEnd":2},{"summary":"Second","severity":"critical","category":"security","lineStart":2,"lineEnd":2},{"summary":"Third","severity":"critical","category":"security","lineStart":2,"lineEnd":2}]}`)))
			return
		}
		count := active.Add(1)
		defer active.Add(-1)
		for old := peak.Load(); count > old; old = peak.Load() {
			if peak.CompareAndSwap(old, count) {
				break
			}
		}
		if count == 3 {
			release.Do(func() { close(ready) })
		}
		select {
		case <-ready:
		case <-r.Context().Done():
			return
		}
		var target struct {
			Summary string `json:"summary"`
		}
		if json.Unmarshal([]byte(payload.Messages[len(payload.Messages)-1].Content), &target) != nil {
			w.WriteHeader(400)
			return
		}
		var response modelReview
		if json.Unmarshal(fixture, &response) != nil {
			w.WriteHeader(500)
			return
		}
		response.Findings[0].Summary = target.Summary
		data, _ := json.Marshal(response)
		_, _ = w.Write(completion(structuredFixture(t, data)))
	}))
	defer upstream.Close()
	metrics := liveFanout(&http.Client{Timeout: time.Second}, Config{APIKey: "test-key", Model: "test-model", BaseURL: upstream.URL, MaxCompletionTokens: 4096}, messages, request.Code, contract)
	if peak.Load() != 3 {
		t.Fatalf("concurrent requests=%d, want 3", peak.Load())
	}
	if !metrics.Valid || metrics.ValidDetails != 3 || metrics.Findings != 3 {
		t.Fatalf("invalid merged result: %+v", metrics)
	}
}

func TestIdentityMergeUsesOccurrencesInsteadOfNames(t *testing.T) {
	reference := func(id string, line int) api.SymbolReference {
		return api.SymbolReference{SymbolId: id, Symbol: "value", Line: line, StartColumn: 1, EndColumn: 6, Role: api.Source}
	}
	first := []api.SymbolReference{reference("d0:binding", 1), reference("d0:binding", 2)}
	second := []api.SymbolReference{reference("d1:same-binding", 2), reference("d1:same-binding", 3), reference("d1:other-scope", 4)}
	findings := []api.ReviewFinding{{Steps: []api.ExplanationStep{{Links: &first}}}, {Steps: []api.ExplanationStep{{Links: &second}}}}
	unifyLiveIdentities(findings)
	if first[0].SymbolId != second[0].SymbolId || first[1].SymbolId != second[1].SymbolId {
		t.Fatal("shared occurrence failed to unify the complete binding")
	}
	if second[2].SymbolId == first[0].SymbolId {
		t.Fatal("distinct scopes merged based on symbol text")
	}
}
