package review

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"sort"
	"time"

	"github.com/yuxincs/reviewlet/backend/internal/api"
)

type Service struct {
	provider *provider
	contract *api.Contract
	timeout  time.Duration
}

func NewService(config Config) (*Service, error) {
	if err := config.validate(); err != nil {
		return nil, err
	}
	contract, err := api.LoadContract()
	if err != nil {
		return nil, err
	}
	return &Service{
		provider: &provider{
			config: config, schema: contract.ModelJSON,
			client: &http.Client{
				Timeout:       config.Timeout,
				CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
			},
		},
		contract: contract, timeout: config.Timeout,
	}, nil
}

func (s *Service) ReviewSnippet(ctx context.Context, request api.ReviewSnippetRequestObject) (api.ReviewSnippetResponseObject, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	if request.Body == nil {
		return invalidRequest(), nil
	}
	data, err := s.provider.generate(ctx, *request.Body)
	if err != nil {
		return asResponse(err), nil
	}
	result, err := decodeStructuredReview(data, request.Body.Code, s.contract)
	if err != nil {
		return asResponse(err), nil
	}
	if ctx.Err() != nil {
		return timeoutReview(), nil
	}
	// Give repeatable ordering even if the provider returned findings out of order.
	priority := map[api.ReviewFindingSeverity]int{api.Critical: 0, api.Warning: 1, api.Info: 2}
	sort.SliceStable(result.Findings, func(i, j int) bool {
		a, b := result.Findings[i], result.Findings[j]
		if a.LineStart != b.LineStart {
			return a.LineStart < b.LineStart
		}
		if a.LineEnd != b.LineEnd {
			return a.LineEnd < b.LineEnd
		}
		return priority[a.Severity] < priority[b.Severity]
	})
	hash := sha256.Sum256([]byte(request.Body.Code))
	response := api.ReviewResponse{
		Id: rand.Text(), CreatedAt: time.Now().UTC(), CodeHash: hex.EncodeToString(hash[:]),
		Language: result.Language, Summary: result.Summary, Findings: result.Findings,
	}
	encoded, err := json.Marshal(response)
	if err != nil || validateJSON(encoded, s.contract.Response) != nil {
		return internalError(), nil
	}
	return api.ReviewSnippet200JSONResponse(response), nil
}
