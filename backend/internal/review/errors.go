package review

import (
	"net/http"

	"github.com/yuxincs/reviewlet/backend/internal/api"
)

type reviewError struct {
	status  int
	code    api.ErrorResponseErrorCode
	message string
}

func (e *reviewError) Error() string { return e.message }

func invalidRequest() *reviewError {
	return &reviewError{status: http.StatusBadRequest, code: api.ErrorResponseErrorCodeInvalidRequest, message: "Supply a non-blank code snippet as JSON."}
}

func internalError() *reviewError {
	return &reviewError{status: http.StatusInternalServerError, code: api.ErrorResponseErrorCodeInternalError, message: "The review could not be completed."}
}
