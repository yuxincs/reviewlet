package review

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/yuxincs/reviewlet/backend/internal/api"
	"github.com/yuxincs/reviewlet/backend/internal/logging"
)

// Streams full snapshots so clients never need to reconstruct a partially applied
// patch. A single goroutine owns persistence and publication; workers own guides.
func (s *Service) stagedReview(ctx context.Context, input api.ReviewRequest, publish func(api.ReviewResponse) error) (err error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	started := time.Now()
	var token string
	if input.SnippetId != nil {
		if s.store == nil {
			return internalError()
		}
		token, err = s.store.BeginReview(ctx, input)
		if err != nil {
			return workspaceError(err)
		}
		defer func() {
			cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
			defer done()
			saved, cleanupErr := s.store.FailReview(cleanup, *input.SnippetId, token)
			if err != nil && cleanupErr == nil {
				asResponse(err).snippetVersion = &saved.Version
			}
		}()
	}
	messages, err := reviewMessages(input)
	if err != nil {
		return internalError()
	}
	discoveryPrompt, _ := promptFS.ReadFile("prompts/findings.txt")
	schema := discoverySchema(s.contract)
	detector := *s.provider
	detector.schema = string(schema)
	data, err := detector.generateMessages(ctx, []message{{Role: "system", Content: string(discoveryPrompt)}, messages[1]})
	if err != nil {
		return err
	}
	compiler := jsonschema.NewCompiler()
	document, schemaErr := jsonschema.UnmarshalJSON(bytes.NewReader(schema))
	if schemaErr != nil {
		return internalError()
	}
	if err := compiler.AddResource("https://reviewlet.local/findings", document); err != nil {
		return internalError()
	}
	compiled, err := compiler.Compile("https://reviewlet.local/findings")
	if err != nil {
		return internalError()
	}
	if validateJSON(data, compiled) != nil {
		return failedReview()
	}
	var detected struct {
		Findings []api.ReviewFinding `json:"findings"`
	}
	if json.Unmarshal(data, &detected) != nil || len(detected.Findings) > 12 {
		return failedReview()
	}
	sort.SliceStable(detected.Findings, func(i, j int) bool {
		a, b := detected.Findings[i], detected.Findings[j]
		if a.LineStart != b.LineStart {
			return a.LineStart < b.LineStart
		}
		if a.LineEnd != b.LineEnd {
			return a.LineEnd < b.LineEnd
		}
		priority := map[api.ReviewFindingSeverity]int{api.Critical: 0, api.Warning: 1, api.Info: 2}
		return priority[a.Severity] < priority[b.Severity]
	})
	language := "unknown"
	if input.Language != nil {
		language = *input.Language
	}
	phase := api.Detailing
	hash := sha256.Sum256([]byte(input.Code))
	response := api.ReviewResponse{Id: rand.Text(), CreatedAt: time.Now().UTC(), CodeHash: hex.EncodeToString(hash[:]), Language: language, Summary: fmt.Sprintf("Found %d findings.", len(detected.Findings)), Findings: detected.Findings, Phase: &phase}
	for i := range response.Findings {
		f := &response.Findings[i]
		f.Id = fmt.Sprintf("f%d", i+1)
		status := api.ReviewFindingDetailStatusPending
		f.DetailStatus = &status
		f.Description = "Preparing a detailed explanation of this finding."
		f.Steps = []api.ExplanationStep{{Description: "Analyzing data flow and suggested changes."}}
	}
	if len(response.Findings) == 0 {
		response.Summary = "No actionable issues found."
		phase = api.Complete
	}
	// Validate discovery metadata against all public bounds before exposing it.
	if _, err := normalizeReview(modelReview{Language: language, Summary: response.Summary, Findings: response.Findings}, input.Code, s.contract); err != nil {
		return err
	}
	emit := func(final bool) error {
		// Namespace provider-local identities, then merge only bindings sharing an
		// exact source occurrence. Never merge variables merely by their spelling.
		snapshot := cloneResponse(response)
		mergeGuideIdentities(snapshot.Findings)
		encoded, encodeErr := json.Marshal(snapshot)
		if encodeErr != nil || validateJSON(encoded, s.contract.Response) != nil {
			return failedReview()
		}
		if input.SnippetId != nil {
			saved, saveErr := s.store.ProgressReview(ctx, *input.SnippetId, token, snapshot, final)
			if saveErr != nil {
				return workspaceError(saveErr)
			}
			snapshot.SnippetVersion = &saved.Version
		}
		return publish(snapshot)
	}
	if err := emit(phase == api.Complete); err != nil {
		return err
	}
	if phase == api.Complete {
		return nil
	}
	logging.FromContext(ctx, s.logger).InfoContext(ctx, "review_findings_discovered", "finding_count", len(response.Findings), "duration_ms", time.Since(started).Milliseconds())
	type outcome struct {
		index   int
		finding api.ReviewFinding
		err     error
	}
	outcomes := make(chan outcome, len(response.Findings))
	targets := append([]api.ReviewFinding(nil), response.Findings...)
	jobs := make(chan int)
	var workers sync.WaitGroup
	for range min(3, len(response.Findings)) {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for i := range jobs {
				finding, detailErr := s.generateGuide(ctx, input, messages, targets[i])
				outcomes <- outcome{i, finding, detailErr}
			}
		}()
	}
	// Workers read an immutable target copy; only this goroutine updates snapshots.
	go func() {
		defer close(jobs)
		for i := range detected.Findings {
			select {
			case jobs <- i:
			case <-ctx.Done():
				return
			}
		}
	}()
	defer func() { cancel(); workers.Wait() }()
	for remaining := len(response.Findings); remaining > 0; remaining-- {
		select {
		case <-ctx.Done():
			return timeoutReview()
		case result := <-outcomes:
			if result.err != nil {
				f := &response.Findings[result.index]
				status := api.ReviewFindingDetailStatusFailed
				f.DetailStatus = &status
				message := "Could not generate this guide. The detected finding is still available."
				f.DetailError = &message
				logging.FromContext(ctx, s.logger).WarnContext(ctx, "review_guide_failed", "finding_id", f.Id, "error_code", asResponse(result.err).code)
			} else {
				response.Findings[result.index] = result.finding
			}
			if remaining == 1 {
				phase = api.Complete
			}
			if err := emit(remaining == 1); err != nil {
				cancel()
				return err
			}
		}
	}
	logging.FromContext(ctx, s.logger).InfoContext(ctx, "staged_review_completed", "review_id", response.Id, "finding_count", len(response.Findings), "duration_ms", time.Since(started).Milliseconds())
	return nil
}

func (s *Service) generateGuide(ctx context.Context, input api.ReviewRequest, messages []message, target api.ReviewFinding) (api.ReviewFinding, error) {
	targetJSON, _ := json.Marshal(map[string]any{"summary": target.Summary, "severity": target.Severity, "category": target.Category, "lineStart": target.LineStart, "lineEnd": target.LineEnd})
	prompt, _ := promptFS.ReadFile("prompts/details.txt")
	detailMessages := append(append([]message{}, messages...), message{Role: "system", Content: string(prompt)}, message{Role: "user", Content: string(targetJSON)})
	detail := *s.provider
	detail.config.DetailModel = s.provider.config.DetailModel
	if detail.config.DetailModel == "" {
		detail.config.DetailModel = "gpt-6-luna"
	}
	models := []string{detail.config.DetailModel}
	if models[0] != s.provider.config.Model {
		models = append(models, s.provider.config.Model)
	}
	for attempt, model := range models {
		if ctx.Err() != nil {
			return api.ReviewFinding{}, timeoutReview()
		}
		detail.config.Model = model
		data, err := detail.generateMessages(ctx, detailMessages)
		// Do not retry authentication, rate-limit or transport failures on another model.
		if err != nil {
			if asResponse(err).code == api.ErrorResponseErrorCodeReviewFailed && attempt+1 < len(models) {
				continue
			}
			return api.ReviewFinding{}, err
		}
		review, err := decodeStructuredReview(data, input.Code, s.contract)
		if err == nil && len(review.Findings) == 1 {
			f := review.Findings[0]
			if f.Summary == target.Summary && f.Severity == target.Severity && f.Category == target.Category && f.LineStart == target.LineStart && f.LineEnd == target.LineEnd {
				f.Id = target.Id
				status := api.ReviewFindingDetailStatusReady
				f.DetailStatus = &status
				return f, nil
			}
		}
		logging.FromContext(ctx, s.logger).WarnContext(ctx, "review_guide_rejected", "finding_id", target.Id, "model", model)
	}
	return api.ReviewFinding{}, failedReview()
}

func cloneResponse(response api.ReviewResponse) api.ReviewResponse {
	data, _ := json.Marshal(response)
	var result api.ReviewResponse
	_ = json.Unmarshal(data, &result)
	return result
}

func discoverySchema(contract *api.Contract) json.RawMessage {
	var full map[string]any
	_ = json.Unmarshal([]byte(contract.ModelJSON), &full)
	properties := full["$defs"].(map[string]any)["ReviewFinding"].(map[string]any)["properties"].(map[string]any)
	fields := []string{"summary", "severity", "category", "lineStart", "lineEnd"}
	subset := map[string]any{}
	for _, field := range fields {
		subset[field] = properties[field]
	}
	schema, _ := json.Marshal(map[string]any{"type": "object", "additionalProperties": false, "required": []string{"findings"}, "properties": map[string]any{"findings": map[string]any{"type": "array", "maxItems": 12, "items": map[string]any{"type": "object", "additionalProperties": false, "required": fields, "properties": subset}}}})
	return schema
}
