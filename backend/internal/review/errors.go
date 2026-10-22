package review

import (
	"net/http"

	"github.com/yuxincs/reviewlet/backend/internal/api"
)

type reviewError struct {
	status     int
	code       api.ErrorResponseErrorCode
	message    string
	retryAfter int
}

func (e *reviewError) Error() string { return e.message }

func invalidRequest() *reviewError {
	return &reviewError{status: http.StatusBadRequest, code: api.ErrorResponseErrorCodeInvalidRequest, message: "Invalid request. Supply non-blank code (at most 30,000 UTF-16 units), an optional lowercase language identifier, and optional context (at most 4,000 characters)."}
}

func failedReview() *reviewError {
	return &reviewError{status: http.StatusBadGateway, code: api.ErrorResponseErrorCodeReviewFailed, message: "The provider did not return a valid review. Try again."}
}

func internalError() *reviewError {
	return &reviewError{status: http.StatusInternalServerError, code: api.ErrorResponseErrorCodeInternalError, message: "The review could not be completed."}
}
