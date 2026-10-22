package review

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/yuxincs/reviewlet/backend/internal/api"
	"github.com/yuxincs/reviewlet/backend/internal/logging"
)

func TestCorrelatedReviewLogs(t *testing.T) {
	for _, scenario := range []string{"success", "provider failure", "invalid output", "invalid request"} {
		t.Run(scenario, func(t *testing.T) {
			var output bytes.Buffer
			logger, err := logging.New(&output, "")
			if err != nil {
				t.Fatal(err)
			}
			service := testServiceWithLogger(t, func(w http.ResponseWriter, _ *http.Request) {
				if scenario == "provider failure" {
					w.WriteHeader(503)
					_, _ = w.Write([]byte("provider-error-secret"))
					return
				}
				review := `{"language":"javascript","summary":"model-output-secret","findings":[]}`
				if scenario == "invalid output" {
					review = `{"language":"javascript","summary":"model-output-secret","findings":null}`
				}
				_, _ = w.Write(completion([]byte(review)))
			}, time.Second, logger)
			body := `{"code":"const secret = 'code-secret';","context":"context-secret"}`
			if scenario == "invalid request" {
				body = `{"code":"","extra":"code-secret"}`
			}
			request := httptest.NewRequest(http.MethodPost, "/api/v1/review?token=query-secret", strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Authorization", "Bearer client-key-secret")
			response := httptest.NewRecorder()
			service.Handler().ServeHTTP(response, request)
			id := response.Header().Get("X-Request-ID")
			if id == "" {
				t.Fatal("missing response request ID")
			}
			expected := map[string]int{"success": 200, "provider failure": 503, "invalid output": 502, "invalid request": 400}[scenario]
			if response.Code != expected {
				t.Fatalf("%d: %s", response.Code, response.Body.String())
			}
			if scenario != "success" {
				var failure api.ErrorResponse
				if err := json.Unmarshal(response.Body.Bytes(), &failure); err != nil {
					t.Fatal(err)
				}
				if failure.Error.RequestId == nil || *failure.Error.RequestId != id {
					t.Fatal("error envelope request ID does not match logs/header")
				}
			}
			events := map[string]map[string]any{}
			for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
				var record map[string]any
				if err := json.Unmarshal([]byte(line), &record); err != nil {
					t.Fatal(err)
				}
				if record["request_id"] != id {
					t.Fatalf("uncorrelated log: %+v", record)
				}
				events[record["msg"].(string)] = record
			}
			access := events["http_request_completed"]
			if access["status"] != float64(expected) || access["route"] != "POST /api/v1/review" {
				t.Fatalf("incorrect HTTP log: %+v", access)
			}
			switch scenario {
			case "success":
				if events["provider_request_started"] == nil || events["provider_request_completed"]["upstream_status"] != float64(200) || events["review_completed"]["finding_count"] != float64(0) {
					t.Fatal("missing review/provider success logs")
				}
			case "provider failure":
				failure := events["provider_request_failed"]
				if failure["upstream_status"] != float64(503) || failure["stage"] != "http_status" || failure["error_code"] != "review_unavailable" {
					t.Fatalf("missing safe provider diagnostics: %+v", failure)
				}
			case "invalid output":
				if events["review_output_rejected"]["stage"] != "validate_output" {
					t.Fatal("missing output validation log")
				}
			case "invalid request":
				if events["provider_request_started"] != nil {
					t.Fatal("invalid input reached provider")
				}
			}
			for _, secret := range []string{"code-secret", "context-secret", "query-secret", "client-key-secret", "test-key", "provider-error-secret", "model-output-secret", "Trust boundary"} {
				if strings.Contains(output.String(), secret) {
					t.Fatalf("log contains private input: %s", secret)
				}
			}
		})
	}
}
