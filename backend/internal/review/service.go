package review

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"sort"
	"time"

	"github.com/yuxincs/reviewlet/backend/internal/api"
	"github.com/yuxincs/reviewlet/backend/internal/logging"
	"github.com/yuxincs/reviewlet/backend/internal/storage"
)

type Service struct {
	store    *storage.Store
	logger   *slog.Logger
	provider *provider
	contract *api.Contract
	timeout  time.Duration
}

func NewService(config Config, logger *slog.Logger) (*Service, error) {
	if logger == nil {
		logger = slog.Default()
	}
	if err := config.validate(); err != nil {
		return nil, err
	}
	contract, err := api.LoadContract()
	if err != nil {
		return nil, err
	}
	return &Service{
		logger: logger,
		provider: &provider{
			logger: logger,
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
	var run string
	if request.Body.SnippetId != nil {
		if s.store == nil {
			return internalError(), nil
		}
		var err error
		run, err = s.store.BeginReview(ctx, *request.Body)
		if err != nil {
			return workspaceError(err), nil
		}
		defer func() {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			// A completed or superseded run is untouched by token matching.
			_ = s.store.FailReview(cleanup, *request.Body.SnippetId, run)
		}()
	}
	data, err := s.provider.generate(ctx, *request.Body)
	if err != nil {
		return asResponse(err), nil
	}
	result, err := decodeStructuredReview(data, request.Body.Code, s.contract)
	if err != nil {
		logging.FromContext(ctx, s.logger).ErrorContext(ctx, "review_output_rejected", "stage", "validate_output", "error_code", asResponse(err).code)
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
		logging.FromContext(ctx, s.logger).ErrorContext(ctx, "review_output_rejected", "stage", "validate_response", "error_code", api.ErrorResponseErrorCodeInternalError)
		return internalError(), nil
	}
	if request.Body.SnippetId != nil {
		if err := s.store.CompleteReview(ctx, *request.Body.SnippetId, run, response); err != nil {
			return workspaceError(err), nil
		}
	}
	logging.FromContext(ctx, s.logger).InfoContext(ctx, "review_completed", "review_id", response.Id, "finding_count", len(response.Findings))
	return api.ReviewSnippet200JSONResponse(response), nil
}
