package review

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/yuxincs/reviewlet/backend/internal/api"
)

func detectionFixture(t *testing.T, findings []api.ReviewFinding) []byte {
	t.Helper()
	items := make([]map[string]any, 0, len(findings))
	for _, f := range findings {
		items = append(items, map[string]any{"summary": f.Summary, "severity": f.Severity, "category": f.Category, "lineStart": f.LineStart, "lineEnd": f.LineEnd})
	}
	data, err := json.Marshal(map[string]any{"findings": items})
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestStagedProgressBeforeDetailsAndFallback(t *testing.T) {
	input, expected, model := exampleReview(t)
	detail := structuredFixture(t, model)
	release := make(chan struct{})
	defer close(release)
	started := make(chan struct{}, 1)
	var luna, primary atomic.Int32
	service := testService(t, func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Model    string    `json:"model"`
			Messages []message `json:"messages"`
		}
		if json.NewDecoder(r.Body).Decode(&payload) != nil {
			t.Error("invalid payload")
			return
		}
		if len(payload.Messages) == 2 {
			_, _ = w.Write(completion(detectionFixture(t, expected.Findings)))
			return
		}
		if payload.Model == "gpt-6-luna" {
			luna.Add(1)
			started <- struct{}{}
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
			_, _ = w.Write(completion([]byte(`{}`)))
			return
		}
		primary.Add(1)
		_, _ = w.Write(completion(detail))
	}, 5*time.Second)
	server := httptest.NewServer(service.Handler())
	defer server.Close()
	body, _ := json.Marshal(input)
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/review", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	reader := bufio.NewScanner(response.Body)
	readSnapshot := func(want string) api.ReviewResponse {
		t.Helper()
		event := ""
		for reader.Scan() {
			line := reader.Text()
			if strings.HasPrefix(line, "event: ") {
				event = strings.TrimPrefix(line, "event: ")
			}
			if strings.HasPrefix(line, "data: ") {
				if event != want {
					t.Fatalf("event=%s want %s: %s", event, want, line)
				}
				var result api.ReviewResponse
				if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &result); err != nil {
					t.Fatal(err)
				}
				return result
			}
		}
		t.Fatalf("stream ended: %v", reader.Err())
		return api.ReviewResponse{}
	}
	first := readSnapshot("progress")
	if first.Phase == nil || *first.Phase != api.Detailing || len(first.Findings) != 1 || *first.Findings[0].DetailStatus != api.ReviewFindingDetailStatusPending {
		t.Fatalf("bad discovery: %+v", first)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("detail request not started")
	}
	// Release after discovery was actually read from the HTTP stream.
	release <- struct{}{}
	last := readSnapshot("complete")
	if last.Id != first.Id || last.CodeHash != first.CodeHash || last.Findings[0].Id != first.Findings[0].Id || *last.Findings[0].DetailStatus != api.ReviewFindingDetailStatusReady || luna.Load() != 1 || primary.Load() != 1 {
		t.Fatalf("bad final/fallback: %+v", last)
	}
}

func TestStagedBoundedConcurrencyAndIsolatedFailures(t *testing.T) {
	input, expected, model := exampleReview(t)
	base := expected.Findings[0]
	var findings []api.ReviewFinding
	for i := range 5 {
		f := base
		f.Summary = fmt.Sprintf("Finding %d", i)
		findings = append(findings, f)
	}
	var active, maximum atomic.Int32
	gate := make(chan struct{})
	started := make(chan struct{}, 5)
	service := testService(t, func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Model    string    `json:"model"`
			Messages []message `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		if len(payload.Messages) == 2 {
			_, _ = w.Write(completion(detectionFixture(t, findings)))
			return
		}
		current := active.Add(1)
		defer active.Add(-1)
		for {
			old := maximum.Load()
			if current <= old || maximum.CompareAndSwap(old, current) {
				break
			}
		}
		started <- struct{}{}
		select {
		case <-gate:
		case <-r.Context().Done():
			return
		}
		var target api.ReviewFinding
		_ = json.Unmarshal([]byte(payload.Messages[len(payload.Messages)-1].Content), &target)
		if target.Summary == "Finding 1" {
			_, _ = w.Write(completion([]byte(`{}`)))
			return
		}
		var full modelReview
		_ = json.Unmarshal(model, &full)
		full.Findings[0].Summary = target.Summary
		data, _ := json.Marshal(full)
		_, _ = w.Write(completion(structuredFixture(t, data)))
	}, 5*time.Second)
	type answer struct {
		err       error
		snapshots []api.ReviewResponse
	}
	done := make(chan answer, 1)
	go func() {
		var snapshots []api.ReviewResponse
		err := service.stagedReview(context.Background(), input, func(r api.ReviewResponse) error { snapshots = append(snapshots, r); return nil })
		done <- answer{err, snapshots}
	}()
	for range 3 {
		select {
		case <-started:
		case <-time.After(time.Second):
			close(gate)
			t.Fatal("workers did not run concurrently")
		}
	}
	if active.Load() != 3 {
		t.Fatal("expected three simultaneous guide requests")
	}
	close(gate)
	result := <-done
	if result.err != nil {
		t.Fatal(result.err)
	}
	if maximum.Load() > 3 || len(result.snapshots) != 6 {
		t.Fatalf("max=%d snapshots=%d", maximum.Load(), len(result.snapshots))
	}
	final := result.snapshots[5]
	for i, f := range final.Findings {
		status := api.ReviewFindingDetailStatusReady
		if i == 1 {
			status = api.ReviewFindingDetailStatusFailed
		}
		if f.DetailStatus == nil || *f.DetailStatus != status {
			t.Fatalf("finding %d status: %+v", i, f)
		}
	}
	if *result.snapshots[0].Findings[0].DetailStatus != api.ReviewFindingDetailStatusPending {
		t.Fatal("later updates mutated a prior snapshot")
	}
}

func TestStagedEmptyAndInvalidDiscovery(t *testing.T) {
	for _, tc := range []struct {
		name, content string
		wantErr       bool
	}{{"empty", `{"findings":[]}`, false}, {"out of bounds", `{"findings":[{"summary":"Bug","severity":"warning","category":"bug","lineStart":999,"lineEnd":999}]}`, true}, {"missing findings", `{}`, true}} {
		t.Run(tc.name, func(t *testing.T) {
			input, _, _ := exampleReview(t)
			service := testService(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(completion([]byte(tc.content))) }, time.Second)
			var snapshots []api.ReviewResponse
			err := service.stagedReview(context.Background(), input, func(r api.ReviewResponse) error { snapshots = append(snapshots, r); return nil })
			if (err != nil) != tc.wantErr {
				t.Fatalf("error=%v", err)
			}
			if !tc.wantErr && (len(snapshots) != 1 || *snapshots[0].Phase != api.Complete || len(snapshots[0].Findings) != 0) {
				t.Fatalf("bad empty result: %+v", snapshots)
			}
		})
	}
}

func TestStagedCancellationStopsDetailRequests(t *testing.T) {
	input, expected, _ := exampleReview(t)
	started := make(chan struct{})
	cancelled := make(chan struct{})
	service := testService(t, func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Messages []message `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		if len(payload.Messages) == 2 {
			_, _ = w.Write(completion(detectionFixture(t, expected.Findings)))
			return
		}
		close(started)
		<-r.Context().Done()
		close(cancelled)
	}, 5*time.Second)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- service.stagedReview(ctx, input, func(api.ReviewResponse) error { return nil }) }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("details did not start")
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancelled review succeeded")
		}
	case <-time.After(time.Second):
		t.Fatal("review did not stop")
	}
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("provider request was not cancelled")
	}
}

func TestMergeGuideIdentitiesUsesSourceOccurrences(t *testing.T) {
	finding := func(id string, line int) api.ReviewFinding {
		links := []api.SymbolReference{{SymbolId: "local", Symbol: "value", Line: line, StartColumn: 1, EndColumn: 6}}
		return api.ReviewFinding{Id: id, Steps: []api.ExplanationStep{{Links: &links}}}
	}
	a, b := finding("f1", 1), finding("f2", 2)
	findings := []api.ReviewFinding{a, b}
	mergeGuideIdentities(findings)
	first := (*findings[0].Steps[0].Links)[0].SymbolId
	second := (*findings[1].Steps[0].Links)[0].SymbolId
	if first == second {
		t.Fatal("merged unrelated provider-local identifiers")
	}
	a, b = finding("f1", 1), finding("f2", 1)
	findings = []api.ReviewFinding{a, b}
	mergeGuideIdentities(findings)
	if (*findings[0].Steps[0].Links)[0].SymbolId != (*findings[1].Steps[0].Links)[0].SymbolId {
		t.Fatal("did not merge a shared exact occurrence")
	}
}
