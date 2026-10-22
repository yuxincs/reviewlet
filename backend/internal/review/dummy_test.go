package review

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/yuxincs/reviewlet/backend/internal/api"
)

func TestDummyReview(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/review", strings.NewReader(`{"code":"const x = 1;","language":"javascript"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	NewService().Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("%d: %s", response.Code, response.Body.String())
	}
	var result api.ReviewResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte("const x = 1;"))
	if result.Id == "" || result.CreatedAt.IsZero() || result.CodeHash != hex.EncodeToString(hash[:]) || result.Language != "javascript" || result.Findings == nil || len(result.Findings) != 0 || !strings.Contains(result.Summary, "Dummy") {
		t.Fatalf("unexpected dummy review: %+v", result)
	}
	if response.Header().Get("Content-Type") != "application/json" || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("unexpected response headers")
	}
}

func TestDummyReviewInvalidInput(t *testing.T) {
	for _, body := range []string{"{", `{"code":""}`, `{"code":" \n\t"}`} {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/review", strings.NewReader(body))
		response := httptest.NewRecorder()
		NewService().Handler().ServeHTTP(response, request)
		var result api.ErrorResponse
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if response.Code != http.StatusBadRequest || result.Error.Code != api.ErrorResponseErrorCodeInvalidRequest {
			t.Fatalf("%d: %s", response.Code, response.Body.String())
		}
	}
}
