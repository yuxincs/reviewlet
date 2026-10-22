package review

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/yuxincs/reviewlet/backend/internal/api"
	"github.com/yuxincs/reviewlet/backend/internal/storage"
)

func workspaceCall(t *testing.T, handler http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(method, path, bytes.NewReader(encoded))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
func TestWorkspaceHTTPPersistence(t *testing.T) {
	request, _, modelJSON := exampleReview(t)
	modelJSON = structuredFixture(t, modelJSON)
	service := testService(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(completion(modelJSON)) }, time.Second)
	path := filepath.Join(t.TempDir(), "workspace.db")
	store, err := storage.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	service.UseStore(store)
	handler := service.Handler()
	language := "javascript"
	if request.Language != nil {
		language = *request.Language
	}
	context := ""
	if request.Context != nil {
		context = *request.Context
	}
	draft := map[string]any{"title": "Example", "language": language, "code": request.Code, "context": context}
	invalidID := workspaceCall(t, handler, "PUT", "/api/v1/snippets/not-a-uuid", draft)
	assertError(t, invalidID, 400, api.ErrorResponseErrorCodeInvalidRequest)
	response := workspaceCall(t, handler, "PUT", "/api/v1/snippets/6405d432-0160-417f-9c20-700ea4070782", draft)
	if response.Code != 200 {
		t.Fatalf("save %d: %s", response.Code, response.Body.String())
	}
	request.SnippetId = new("6405d432-0160-417f-9c20-700ea4070782")
	response = workspaceCall(t, handler, "POST", "/api/v1/review", request)
	if response.Code != 200 {
		t.Fatalf("review %d: %s", response.Code, response.Body.String())
	}
	var review api.ReviewResponse
	if err := json.Unmarshal(response.Body.Bytes(), &review); err != nil {
		t.Fatal(err)
	}
	response = workspaceCall(t, handler, "PATCH", "/api/v1/snippets/6405d432-0160-417f-9c20-700ea4070782/findings/"+review.Findings[0].Id, map[string]any{"reviewId": review.Id, "status": "dismissed"})
	if response.Code != 200 {
		t.Fatalf("decision %d: %s", response.Code, response.Body.String())
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = storage.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.Close() }()
	service.UseStore(store)
	response = workspaceCall(t, handler, "GET", "/api/v1/snippets", nil)
	var saved []api.SavedSnippet
	if err := json.Unmarshal(response.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if len(saved) != 1 || saved[0].ReviewStatus != api.Reviewed || saved[0].Review.FindingStates[review.Findings[0].Id].Status != api.SavedFindingStateStatusDismissed {
		t.Fatalf("lost persisted decisions: %s", response.Body.String())
	}
	if saved[0].Title != "Example" || string(saved[0].Language) != language || saved[0].CreatedAt.IsZero() || saved[0].Id != "6405d432-0160-417f-9c20-700ea4070782" {
		t.Fatal("snippet metadata did not persist")
	}
	response = workspaceCall(t, handler, "PUT", "/api/v1/snippets/6405d432-0160-417f-9c20-700ea4070782", draft)
	assertError(t, response, 409, api.ErrorResponseErrorCodeConflict)
	response = workspaceCall(t, handler, "PATCH", "/api/v1/snippets/6405d432-0160-417f-9c20-700ea4070782/findings/"+review.Findings[0].Id, map[string]any{"reviewId": review.Id, "status": "bogus"})
	assertError(t, response, 400, api.ErrorResponseErrorCodeInvalidRequest)
	response = workspaceCall(t, handler, "DELETE", "/api/v1/snippets/6405d432-0160-417f-9c20-700ea4070782", nil)
	if response.Code != 204 {
		t.Fatal(response.Body.String())
	}
}

func TestSavedReviewFailureAndSourceMismatch(t *testing.T) {
	service := testService(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(503) }, time.Second)
	store, err := storage.Open(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.Close() }()
	service.UseStore(store)
	input := api.SaveSnippetRequest{Code: "const x = 1;", Language: api.SaveSnippetRequestLanguageJavascript, Title: "Failure"}
	if _, err := store.Save(context.Background(), "6405d432-0160-417f-9c20-700ea4070782", input); err != nil {
		t.Fatal(err)
	}
	request := api.ReviewRequest{SnippetId: new("6405d432-0160-417f-9c20-700ea4070782"), Code: "different", Language: new("javascript")}
	response := workspaceCall(t, service.Handler(), "POST", "/api/v1/review", request)
	assertError(t, response, 409, api.ErrorResponseErrorCodeConflict)
	request.Code = input.Code
	response = workspaceCall(t, service.Handler(), "POST", "/api/v1/review", request)
	assertError(t, response, 503, api.ErrorResponseErrorCodeReviewUnavailable)
	snippets, err := store.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if snippets[0].ReviewStatus != api.Failed {
		t.Fatal("failure status was not persisted")
	}
}
