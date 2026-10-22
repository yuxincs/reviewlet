package review

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	"github.com/yuxincs/reviewlet/backend/internal/api"
)

type Service struct{}

func NewService() *Service { return &Service{} }

func (s *Service) ReviewSnippet(_ context.Context, request api.ReviewSnippetRequestObject) (api.ReviewSnippetResponseObject, error) {
	if request.Body == nil || strings.TrimSpace(request.Body.Code) == "" {
		return invalidRequest(), nil
	}
	language := "unknown"
	if request.Body.Language != nil && *request.Body.Language != "" {
		language = *request.Body.Language
	}
	hash := sha256.Sum256([]byte(request.Body.Code))
	return api.ReviewSnippet200JSONResponse(api.ReviewResponse{
		Id: rand.Text(), CreatedAt: time.Now().UTC(), CodeHash: hex.EncodeToString(hash[:]),
		Language: language, Summary: "Dummy response; AI review is not connected.", Findings: []api.ReviewFinding{},
	}), nil
}
