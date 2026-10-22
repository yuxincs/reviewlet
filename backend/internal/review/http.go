package review

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"

	"github.com/yuxincs/reviewlet/backend/internal/api"
)

const maxRequestBody = 256 << 10

var _ api.StrictServerInterface = (*Service)(nil)

// Handler mounts generated routes and validates the complete body before binding.
func (s *Service) Handler() http.Handler {
	routes := api.Handler(api.NewStrictHandlerWithOptions(s, nil, api.StrictHTTPServerOptions{
		RequestErrorHandlerFunc:  func(w http.ResponseWriter, _ *http.Request, _ error) { writeError(w, invalidRequest()) },
		ResponseErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, _ error) { writeError(w, internalError()) },
	}))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/review" {
			mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if err != nil || mediaType != "application/json" {
				writeError(w, invalidRequest())
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)
			data, err := io.ReadAll(r.Body)
			if err != nil {
				var limit *http.MaxBytesError
				if errors.As(err, &limit) {
					writeError(w, &reviewError{status: http.StatusRequestEntityTooLarge, code: api.ErrorResponseErrorCodePayloadTooLarge, message: "Request body exceeds 256 KiB."})
				} else {
					writeError(w, invalidRequest())
				}
				return
			}
			if err := validateRequest(data, s.contract); err != nil {
				writeError(w, invalidRequest())
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(data))
		}
		routes.ServeHTTP(w, r)
	})
}

func asResponse(err error) *reviewError {
	var result *reviewError
	if errors.As(err, &result) {
		return result
	}
	return internalError()
}

func (e *reviewError) VisitReviewSnippetResponse(w http.ResponseWriter) error {
	response := api.ErrorResponse{}
	response.Error.Code = e.code
	response.Error.Message = e.message
	w.Header().Set("Content-Type", "application/json")
	if e.retryAfter > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(e.retryAfter))
	}
	w.WriteHeader(e.status)
	return json.NewEncoder(w).Encode(response)
}

func writeError(w http.ResponseWriter, err *reviewError) {
	// A failed write means the client disconnected; do not attempt a second response.
	_ = err.VisitReviewSnippetResponse(w)
}
