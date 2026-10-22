package review

import (
	"context"
	"errors"
	"net/http"
	"regexp"

	"github.com/yuxincs/reviewlet/backend/internal/api"
	"github.com/yuxincs/reviewlet/backend/internal/storage"
)

var snippetID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// UseStore enables single-user workspace persistence before serving requests.
func (s *Service) UseStore(store *storage.Store) { s.store = store }

func workspaceError(err error) *reviewError {
	switch {
	case errors.Is(err, storage.ErrNotFound):
		return &reviewError{status: 404, code: api.ErrorResponseErrorCodeNotFound, message: "The snippet or finding no longer exists."}
	case errors.Is(err, storage.ErrConflict):
		return &reviewError{status: 409, code: api.ErrorResponseErrorCodeConflict, message: "The snippet changed. Reload the workspace before trying again."}
	case errors.Is(err, storage.ErrInvalid):
		return invalidWorkspace()
	default:
		return internalError()
	}
}
func invalidWorkspace() *reviewError {
	return &reviewError{status: 400, code: api.ErrorResponseErrorCodeInvalidRequest, message: "Invalid snippet or review state."}
}

func (s *Service) ListSnippets(ctx context.Context, _ api.ListSnippetsRequestObject) (api.ListSnippetsResponseObject, error) {
	if s.store == nil {
		return internalError(), nil
	}
	snippets, err := s.store.List(ctx)
	if err != nil {
		return workspaceError(err), nil
	}
	return api.ListSnippets200JSONResponse(snippets), nil
}
func (s *Service) SaveSnippet(ctx context.Context, request api.SaveSnippetRequestObject) (api.SaveSnippetResponseObject, error) {
	if s.store == nil {
		return internalError(), nil
	}
	if !snippetID.MatchString(request.Id) || request.Body == nil || codeUnits(request.Body.Code) > maxCodeUnits {
		return invalidWorkspace(), nil
	}
	snippet, err := s.store.Save(ctx, request.Id, *request.Body)
	if err != nil {
		return workspaceError(err), nil
	}
	return api.SaveSnippet200JSONResponse{SavedSnippetResponseJSONResponse: api.SavedSnippetResponseJSONResponse(snippet)}, nil
}
func (s *Service) DeleteSnippet(ctx context.Context, request api.DeleteSnippetRequestObject) (api.DeleteSnippetResponseObject, error) {
	if s.store == nil {
		return internalError(), nil
	}
	if !snippetID.MatchString(request.Id) {
		return invalidWorkspace(), nil
	}
	if err := s.store.Delete(ctx, request.Id); err != nil {
		return workspaceError(err), nil
	}
	return api.DeleteSnippet204Response{}, nil
}
func (s *Service) SaveReviewState(ctx context.Context, request api.SaveReviewStateRequestObject) (api.SaveReviewStateResponseObject, error) {
	if s.store == nil {
		return internalError(), nil
	}
	if !snippetID.MatchString(request.Id) || request.Body == nil || codeUnits(request.Body.Code) > maxCodeUnits {
		return invalidWorkspace(), nil
	}
	snippet, err := s.store.SaveReviewState(ctx, request.Id, *request.Body)
	if err != nil {
		return workspaceError(err), nil
	}
	return api.SaveReviewState200JSONResponse{SavedSnippetResponseJSONResponse: api.SavedSnippetResponseJSONResponse(snippet)}, nil
}
func (s *Service) UpdateFindingDecision(ctx context.Context, request api.UpdateFindingDecisionRequestObject) (api.UpdateFindingDecisionResponseObject, error) {
	if s.store == nil {
		return internalError(), nil
	}
	if !snippetID.MatchString(request.Id) || request.Body == nil {
		return invalidWorkspace(), nil
	}
	snippet, err := s.store.Decide(ctx, request.Id, request.FindingId, *request.Body)
	if err != nil {
		return workspaceError(err), nil
	}
	return api.UpdateFindingDecision200JSONResponse{SavedSnippetResponseJSONResponse: api.SavedSnippetResponseJSONResponse(snippet)}, nil
}
func (e *reviewError) VisitListSnippetsResponse(w http.ResponseWriter) error {
	return e.VisitReviewSnippetResponse(w)
}
func (e *reviewError) VisitSaveSnippetResponse(w http.ResponseWriter) error {
	return e.VisitReviewSnippetResponse(w)
}
func (e *reviewError) VisitDeleteSnippetResponse(w http.ResponseWriter) error {
	return e.VisitReviewSnippetResponse(w)
}
func (e *reviewError) VisitSaveReviewStateResponse(w http.ResponseWriter) error {
	return e.VisitReviewSnippetResponse(w)
}
func (e *reviewError) VisitUpdateFindingDecisionResponse(w http.ResponseWriter) error {
	return e.VisitReviewSnippetResponse(w)
}
