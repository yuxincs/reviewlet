package review

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/yuxincs/reviewlet/backend/internal/api"
	"go.yaml.in/yaml/v3"
)

func exampleReview(t *testing.T) (api.ReviewRequest, api.ReviewResponse, []byte) {
	t.Helper()
	source, err := os.ReadFile("../../../api/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var spec struct {
		Components struct {
			Examples map[string]struct {
				Value map[string]any `yaml:"value"`
			} `yaml:"examples"`
		} `yaml:"components"`
	}
	if err := yaml.Unmarshal(source, &spec); err != nil {
		t.Fatal(err)
	}
	requestJSON, err := json.Marshal(spec.Components.Examples["SqlInjectionRequest"].Value)
	if err != nil {
		t.Fatal(err)
	}
	var request api.ReviewRequest
	if err := json.Unmarshal(requestJSON, &request); err != nil {
		t.Fatal(err)
	}
	response := spec.Components.Examples["SqlInjectionResponse"].Value
	responseJSON, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	var expected api.ReviewResponse
	if err := json.Unmarshal(responseJSON, &expected); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"id", "createdAt", "codeHash"} {
		delete(response, field)
	}
	modelJSON, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	return request, expected, modelJSON
}
