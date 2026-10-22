package review

import (
	"encoding/json"
	"net/http"

	"github.com/yuxincs/reviewlet/backend/internal/api"
)

var _ api.StrictServerInterface = (*Service)(nil)

func (s *Service) Handler() http.Handler {
	routes := api.Handler(api.NewStrictHandlerWithOptions(s, nil, api.StrictHTTPServerOptions{
		RequestErrorHandlerFunc:  func(w http.ResponseWriter, _ *http.Request, _ error) { writeError(w, invalidRequest()) },
		ResponseErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, _ error) { writeError(w, internalError()) },
	}))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		routes.ServeHTTP(w, r)
	})
}

func (e *reviewError) VisitReviewSnippetResponse(w http.ResponseWriter) error {
	response := api.ErrorResponse{}
	response.Error.Code = e.code
	response.Error.Message = e.message
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(e.status)
	return json.NewEncoder(w).Encode(response)
}

func writeError(w http.ResponseWriter, err *reviewError) { _ = err.VisitReviewSnippetResponse(w) }
