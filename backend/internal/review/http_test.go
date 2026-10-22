package review

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/yuxincs/reviewlet/backend/internal/api"
)

func completion(content []byte) []byte {
	result, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{
		"finish_reason": "stop", "message": map[string]any{"content": string(content)},
	}}})
	return result
}

func testService(t *testing.T, providerHandler http.HandlerFunc, timeout time.Duration) *Service {
	return testServiceWithLogger(t, providerHandler, timeout, slog.New(slog.NewJSONHandler(io.Discard, nil)))
}

func testServiceWithLogger(t *testing.T, providerHandler http.HandlerFunc, timeout time.Duration, logger *slog.Logger) *Service {
	t.Helper()
	upstream := httptest.NewServer(providerHandler)
	t.Cleanup(upstream.Close)
	service, err := NewService(Config{APIKey: "test-key", BaseURL: upstream.URL + "/v1", Model: "test-model", Timeout: timeout, MaxCompletionTokens: 4096}, logger)
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func post(handler http.Handler, body []byte) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/review", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func assertError(t *testing.T, response *httptest.ResponseRecorder, status int, code api.ErrorResponseErrorCode) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("status %d, want %d: %s", response.Code, status, response.Body.String())
	}
	if response.Header().Get("Content-Type") != "application/json" {
		t.Fatal("error is not JSON")
	}
	var body api.ErrorResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != code || body.Error.Message == "" {
		t.Fatalf("unexpected error: %+v", body)
	}
	if strings.Contains(response.Body.String(), "provider-secret") {
		t.Fatal("leaked provider detail")
	}
}

func TestReviewHTTP(t *testing.T) {
	request, expected, modelJSON := exampleReview(t)
	modelJSON = structuredFixture(t, modelJSON)
	var calls atomic.Int32
	service := testService(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/v1/chat/completions" || r.Method != http.MethodPost {
			t.Error("wrong provider endpoint")
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("missing provider auth")
		}
		var payload struct {
			Model    string    `json:"model"`
			Messages []message `json:"messages"`
			Format   struct {
				Type       string `json:"type"`
				JSONSchema struct {
					Name   string         `json:"name"`
					Strict bool           `json:"strict"`
					Schema map[string]any `json:"schema"`
				} `json:"json_schema"`
			} `json:"response_format"`
			MaxTokens       int    `json:"max_completion_tokens"`
			ReasoningEffort string `json:"reasoning_effort"`
			Store           *bool  `json:"store"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
			return
		}
		if payload.ReasoningEffort != "low" {
			t.Errorf("reasoning effort = %q, want low", payload.ReasoningEffort)
		}
		if payload.Model != "test-model" || payload.Format.Type != "json_schema" || payload.Format.JSONSchema.Name != "snippet_review" || !payload.Format.JSONSchema.Strict || payload.Format.JSONSchema.Schema["type"] != "object" || payload.Format.JSONSchema.Schema["$defs"] == nil || payload.MaxTokens != 4096 || payload.Store == nil || *payload.Store {
			t.Errorf("incorrect provider configuration: %+v", payload)
		}
		if len(payload.Messages) != 2 {
			t.Error("expected system and user messages")
			return
		}
		if payload.Messages[0].Role != "system" || !strings.Contains(payload.Messages[0].Content, "Trust boundary") || !strings.Contains(payload.Messages[0].Content, "UTF-16") {
			t.Error("missing embedded instructions")
		}
		var supplied struct {
			api.ReviewRequest
			Lines []struct {
				Number int    `json:"number"`
				Text   string `json:"text"`
			} `json:"lines"`
		}
		if err := json.Unmarshal([]byte(payload.Messages[1].Content), &supplied); err != nil {
			t.Error(err)
		}
		if payload.Messages[1].Role != "user" || supplied.Code != "" || supplied.Context == nil || *supplied.Context != *request.Context || len(supplied.Lines) != len(strings.Split(request.Code, "\n")) || supplied.Lines[0].Number != 1 || supplied.Lines[0].Text != strings.Split(request.Code, "\n")[0] {
			t.Error("source or context changed in transit")
		}
		var source []string
		for _, line := range supplied.Lines {
			source = append(source, line.Text)
		}
		if strings.Join(source, "\n") != request.Code {
			t.Error("source lines changed in transit")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(completion(modelJSON))
	}, time.Second)
	encoded, _ := json.Marshal(request)
	before := time.Now().Add(-time.Second)
	response := post(service.Handler(), encoded)
	if response.Code != http.StatusOK {
		t.Fatalf("%d: %s", response.Code, response.Body.String())
	}
	var actual api.ReviewResponse
	if err := json.Unmarshal(response.Body.Bytes(), &actual); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte(request.Code))
	if actual.CodeHash != hex.EncodeToString(hash[:]) || actual.Id == "" || actual.CreatedAt.Before(before) || actual.CreatedAt.After(time.Now()) {
		t.Fatalf("invalid server metadata: %+v", actual)
	}
	if len(actual.Findings) != len(expected.Findings) || actual.Findings[0].Edit == nil || actual.Findings[0].Steps[0].Flow == nil {
		t.Fatal("structured finding data was lost")
	}
	if err := validateJSON(response.Body.Bytes(), service.contract.Response); err != nil {
		t.Fatal(err)
	}
	if response.Header().Get("Cache-Control") != "no-store" || calls.Load() != 1 {
		t.Fatal("unexpected caching or retries")
	}
}

func TestInvalidRequestsNeverCallProvider(t *testing.T) {
	var calls atomic.Int32
	service := testService(t, func(w http.ResponseWriter, _ *http.Request) { calls.Add(1); w.WriteHeader(500) }, time.Second)
	jsonBody := func(value any) string { data, _ := json.Marshal(value); return string(data) }
	tests := map[string]string{
		"missing code": `{}`, "null request": `null`, "array": `[]`, "malformed": `{`,
		"wrong code type": `{"code":4}`, "null code": `{"code":null}`, "empty code": `{"code":""}`,
		"blank": `{"code":" \n\t"}`, "unicode blank": jsonBody(map[string]any{"code": "\u00a0\uFEFF"}),
		"unknown field": `{"code":"x","extra":true}`, "null language": `{"code":"x","language":null}`,
		"empty language": `{"code":"x","language":""}`, "uppercase language": `{"code":"x","language":"Go"}`,
		"bad language": `{"code":"x","language":"../go"}`, "long language": jsonBody(map[string]any{"code": "x", "language": strings.Repeat("a", 65)}),
		"null context": `{"code":"x","context":null}`, "long context": jsonBody(map[string]any{"code": "x", "context": strings.Repeat("a", 4001)}),
		"long code":     jsonBody(map[string]any{"code": strings.Repeat("x", 30001)}),
		"UTF16 limit":   jsonBody(map[string]any{"code": strings.Repeat("😀", 15001)}),
		"trailing JSON": `{"code":"x"} {"code":"y"}`, "trailing garbage": `{"code":"x"} z`,
		"invalid UTF8": "{\"code\":\"\xff\"}",
	}
	for name, body := range tests {
		t.Run(name, func(t *testing.T) {
			assertError(t, post(service.Handler(), []byte(body)), 400, api.ErrorResponseErrorCodeInvalidRequest)
		})
	}
	t.Run("oversize body", func(t *testing.T) {
		body := []byte(`{"code":"x","context":"` + strings.Repeat("a", maxRequestBody) + `"}`)
		assertError(t, post(service.Handler(), body), 413, api.ErrorResponseErrorCodePayloadTooLarge)
	})
	for _, contentType := range []string{"", "text/plain", "application/json; bad"} {
		t.Run("content type "+contentType, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/api/v1/review", strings.NewReader(`{"code":"x"}`))
			request.Header.Set("Content-Type", contentType)
			response := httptest.NewRecorder()
			service.Handler().ServeHTTP(response, request)
			assertError(t, response, 400, api.ErrorResponseErrorCodeInvalidRequest)
		})
	}
	if calls.Load() != 0 {
		t.Fatal("invalid request reached provider")
	}
}

func TestProviderErrors(t *testing.T) {
	cases := []struct {
		status   int
		expected int
		code     api.ErrorResponseErrorCode
	}{
		{429, 429, api.ErrorResponseErrorCodeRateLimited}, {503, 503, api.ErrorResponseErrorCodeReviewUnavailable},
		{500, 503, api.ErrorResponseErrorCodeReviewUnavailable}, {401, 503, api.ErrorResponseErrorCodeReviewUnavailable},
		{403, 503, api.ErrorResponseErrorCodeReviewUnavailable}, {504, 504, api.ErrorResponseErrorCodeReviewTimeout},
		{408, 504, api.ErrorResponseErrorCodeReviewTimeout}, {400, 502, api.ErrorResponseErrorCodeReviewFailed},
	}
	for _, tc := range cases {
		t.Run(http.StatusText(tc.status), func(t *testing.T) {
			service := testService(t, func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Retry-After", "7")
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, "provider-secret")
			}, time.Second)
			response := post(service.Handler(), []byte(`{"code":"x"}`))
			assertError(t, response, tc.expected, tc.code)
			if (tc.status == 429 || tc.status == 503 || tc.status == 500) && response.Header().Get("Retry-After") != "7" {
				t.Fatal("missing retry delay")
			}
		})
	}
}

func TestIncompleteProviderOutput(t *testing.T) {
	valid := `{"language":"go","summary":"No findings.","findings":[]}`
	tests := map[string][]byte{
		"invalid envelope": []byte("bad"), "empty choices": []byte(`{"choices":[]}`),
		"missing finish reason": []byte(`{"choices":[{"message":{"content":"{}"}}]}`),
		"truncated":             []byte(`{"choices":[{"finish_reason":"length","message":{"content":"` + strings.ReplaceAll(valid, `"`, `\"`) + `"}}]}`),
		"refusal":               []byte(`{"choices":[{"finish_reason":"stop","message":{"content":"{}","refusal":"provider-secret"}}]}`),
		"tool call":             []byte(`{"choices":[{"finish_reason":"tool_calls","message":{"content":"{}"}}]}`),
		"not JSON":              completion([]byte("not JSON")), "empty object": completion([]byte(`{}`)),
		"null findings": completion([]byte(`{"language":"go","summary":"No findings.","findings":null}`)),
		"unknown field": completion([]byte(`{"language":"go","summary":"No findings.","findings":[],"id":"fake"}`)),
		"oversize":      []byte(strings.Repeat(" ", maxProviderBody+1)),
	}
	for name, output := range tests {
		t.Run(name, func(t *testing.T) {
			service := testService(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(output) }, time.Second)
			assertError(t, post(service.Handler(), []byte(`{"code":"x"}`)), 502, api.ErrorResponseErrorCodeReviewFailed)
		})
	}
}

func TestReviewDeadlineCancelsProvider(t *testing.T) {
	cancelled := make(chan struct{})
	service := testService(t, func(_ http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		<-r.Context().Done()
		close(cancelled)
	}, 50*time.Millisecond)
	response := post(service.Handler(), []byte(`{"code":"x"}`))
	assertError(t, response, 504, api.ErrorResponseErrorCodeReviewTimeout)
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("provider context was not cancelled")
	}
}

func TestCallerCancellation(t *testing.T) {
	service := testService(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(500) }, time.Second)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := service.provider.generate(ctx, api.ReviewRequest{Code: "x"})
	if err == nil {
		t.Fatal("cancelled request succeeded")
	}
}

func TestEmptyReviewPreservesSourceHash(t *testing.T) {
	service := testService(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(completion([]byte(`{"language":"javascript","summary":"No supported findings.","findings":[]}`)))
	}, time.Second)
	code := "const emoji = \"😀\";\r\n"
	body, _ := json.Marshal(api.ReviewRequest{Code: code})
	ids := map[string]bool{}
	for range 2 {
		response := post(service.Handler(), body)
		if response.Code != 200 {
			t.Fatalf("%d: %s", response.Code, response.Body.String())
		}
		var actual api.ReviewResponse
		if err := json.Unmarshal(response.Body.Bytes(), &actual); err != nil {
			t.Fatal(err)
		}
		hash := sha256.Sum256([]byte(code))
		if actual.CodeHash != hex.EncodeToString(hash[:]) || actual.Findings == nil || len(actual.Findings) != 0 {
			t.Fatalf("source changed or findings not an empty array: %+v", actual)
		}
		if ids[actual.Id] {
			t.Fatal("review IDs were reused")
		}
		ids[actual.Id] = true
	}
}

func TestFindingOrder(t *testing.T) {
	request, _, data := exampleReview(t)
	var model modelReview
	if err := json.Unmarshal(data, &model); err != nil {
		t.Fatal(err)
	}
	template := model.Findings[0]
	model.Findings = nil
	for _, severity := range []api.ReviewFindingSeverity{api.Info, api.Warning, api.Critical} {
		finding := template
		finding.Id = string(severity)
		finding.Severity = severity
		model.Findings = append(model.Findings, finding)
	}
	earlier := template
	earlier.Id = "earlier"
	earlier.LineStart, earlier.LineEnd = 1, 1
	earlier.Severity = api.Info
	model.Findings = append(model.Findings, earlier)
	data, _ = json.Marshal(model)
	data = structuredFixture(t, data)
	service := testService(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(completion(data)) }, time.Second)
	body, _ := json.Marshal(request)
	response := post(service.Handler(), body)
	if response.Code != 200 {
		t.Fatalf("%d: %s", response.Code, response.Body.String())
	}
	var result api.ReviewResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	for i, id := range []string{"f4", "f3", "f2", "f1"} {
		if result.Findings[i].Id != id {
			t.Fatalf("finding %d: got %s, want %s", i, result.Findings[i].Id, id)
		}
	}
}

func TestProviderRedirectIsNotFollowed(t *testing.T) {
	var redirected atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { redirected.Add(1); w.WriteHeader(500) }))
	defer destination.Close()
	service := testService(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
	}, time.Second)
	assertError(t, post(service.Handler(), []byte(`{"code":"x"}`)), 502, api.ErrorResponseErrorCodeReviewFailed)
	if redirected.Load() != 0 {
		t.Fatal("provider redirect was followed")
	}
}

// The API fixture omits optional properties; a strict provider must emit null.
func structuredFixture(t testing.TB, data []byte) []byte {
	t.Helper()
	var review map[string]any
	if err := json.Unmarshal(data, &review); err != nil {
		t.Fatal(err)
	}
	nullable := func(object map[string]any, keys ...string) {
		for _, key := range keys {
			if _, ok := object[key]; !ok {
				object[key] = nil
			}
		}
	}
	for _, findingValue := range review["findings"].([]any) {
		finding := findingValue.(map[string]any)
		delete(finding, "id")
		if edit, ok := finding["edit"].(map[string]any); ok {
			delete(edit, "original")
			finding["fix"] = nil
		}
		nullable(finding, "edit")
		for _, stepValue := range finding["steps"].([]any) {
			step := stepValue.(map[string]any)
			nullable(step, "links", "flow")
			if links, ok := step["links"].([]any); ok {
				for _, link := range links {
					delete(link.(map[string]any), "endColumn")
				}
			}
			if flow, ok := step["flow"].(map[string]any); ok {
				nullable(flow, "connections")
				for _, nodeValue := range flow["nodes"].([]any) {
					node := nodeValue.(map[string]any)
					nullable(node, "reference", "sampleValue")
					if ref, ok := node["reference"].(map[string]any); ok {
						delete(ref, "endColumn")
					}
				}
			}
		}
	}
	result, err := json.Marshal(review)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
