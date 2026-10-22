package review

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/yuxincs/reviewlet/backend/internal/api"
)

type Service struct{ contract *api.Contract }

func NewService() (*Service, error) {
	contract, err := api.LoadContract()
	if err != nil {
		return nil, err
	}
	return &Service{contract: contract}, nil
}

func (s *Service) ReviewSnippet(_ context.Context, request api.ReviewSnippetRequestObject) (api.ReviewSnippetResponseObject, error) {
	if request.Body == nil || !nonblank(request.Body.Code) {
		return invalidRequest(), nil
	}
	language := "unknown"
	if request.Body.Language != nil {
		language = *request.Body.Language
	}
	hash := sha256.Sum256([]byte(request.Body.Code))
	response := api.ReviewResponse{
		Id: rand.Text(), CreatedAt: time.Now().UTC(), CodeHash: hex.EncodeToString(hash[:]),
		Language: language, Summary: "Dummy response; AI review is not connected.", Findings: []api.ReviewFinding{},
	}
	data, err := json.Marshal(response)
	if err != nil || validateJSON(data, s.contract.Response) != nil {
		return internalError(), nil
	}
	return api.ReviewSnippet200JSONResponse(response), nil
}
