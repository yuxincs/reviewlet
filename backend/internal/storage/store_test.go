package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/yuxincs/reviewlet/backend/internal/api"
)

func input() api.SaveSnippetRequest {
	return api.SaveSnippetRequest{Title: "Example", Language: api.SaveSnippetRequestLanguageGo, Code: "return items[0]", Context: "items may be empty"}
}
func request(id string) api.ReviewRequest {
	value := input()
	language := string(value.Language)
	return api.ReviewRequest{SnippetId: &id, Code: value.Code, Language: &language, Context: &value.Context}
}
func result(id string) api.ReviewResponse {
	hash := sha256.Sum256([]byte(input().Code))
	return api.ReviewResponse{Id: id, CreatedAt: time.Now().UTC(), CodeHash: hex.EncodeToString(hash[:]), Language: "go", Summary: "Check empty input", Findings: []api.ReviewFinding{{Id: "f1", Summary: "Empty input", Description: "Indexing can fail", Severity: api.Warning, Category: api.Bug, LineStart: 1, LineEnd: 1, Steps: []api.ExplanationStep{{Description: "Check length"}}, Fix: ""}}}
}
func openTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}
func check(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func TestPersistsReviewAndDismissalAcrossRestart(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "nested", "workspace.db")
	store, err := Open(path)
	check(t, err)
	draft := input()
	mode := api.SaveSnippetRequestLanguageMode("manual")
	draft.LanguageMode = &mode
	saved, err := store.Save(ctx, "snippet", draft)
	check(t, err)
	token, err := store.BeginReview(ctx, request(saved.Id))
	check(t, err)
	check(t, completeReview(store, ctx, saved.Id, token, result("review1")))
	dismissed, err := store.Decide(ctx, saved.Id, "f1", api.FindingDecisionRequest{ReviewId: "review1", Status: api.FindingDecisionRequestStatusDismissed})
	check(t, err)
	check(t, store.Close())
	store, err = Open(path)
	check(t, err)
	defer func() { _ = store.Close() }()
	snippets, err := store.List(ctx)
	check(t, err)
	if len(snippets) != 1 || snippets[0].ReviewStatus != api.Reviewed || snippets[0].Review.FindingStates["f1"].Status != api.SavedFindingStateStatusDismissed || snippets[0].Version != dismissed.Version {
		t.Fatalf("state did not persist: %+v", snippets)
	}
	if snippets[0].LanguageMode == nil || string(*snippets[0].LanguageMode) != "manual" {
		t.Fatal("language override did not persist across restart")
	}
	renamed := input()
	renamed.Title = "Renamed"
	renamed.ExpectedVersion = &dismissed.Version
	saved, err = store.Save(ctx, "snippet", renamed)
	check(t, err)
	if saved.LanguageMode == nil || string(*saved.LanguageMode) != "manual" {
		t.Fatal("renaming reset the language override")
	}
	if saved.Review == nil || saved.Review.FindingStates["f1"].Status != api.SavedFindingStateStatusDismissed {
		t.Fatal("renaming lost decisions")
	}
	renamed.ExpectedVersion = &saved.Version
	renamed.Code = "return nil"
	saved, err = store.Save(ctx, "snippet", renamed)
	check(t, err)
	if saved.Review != nil || saved.ReviewStatus != api.Stale {
		t.Fatal("code change retained old findings")
	}
}

func TestStaleWritesAndLateReviews(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	saved, err := store.Save(ctx, "snippet", input())
	check(t, err)
	_, err = store.Save(ctx, "snippet", input())
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate creation: %v", err)
	}
	token, err := store.BeginReview(ctx, request(saved.Id))
	check(t, err)
	change := input()
	change.ExpectedVersion = &saved.Version
	change.Code = "return nil"
	_, err = store.Save(ctx, "snippet", change)
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("stale version: %v", err)
	}
	snippets, err := store.List(ctx)
	check(t, err)
	change.ExpectedVersion = &snippets[0].Version
	_, err = store.Save(ctx, "snippet", change)
	check(t, err)
	if err := completeReview(store, ctx, "snippet", token, result("old")); !errors.Is(err, ErrConflict) {
		t.Fatalf("late review accepted: %v", err)
	}
	snippets, err = store.List(ctx)
	check(t, err)
	if snippets[0].Code != "return nil" || snippets[0].Review != nil {
		t.Fatal("late review overwrote edits")
	}
	check(t, store.Delete(ctx, "snippet"))
	check(t, store.Delete(ctx, "snippet"))
	if err := completeReview(store, ctx, "snippet", token, result("old")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted snippet restored: %v", err)
	}
}

func TestInterruptedAndSupersededReviews(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "workspace.db")
	store, err := Open(path)
	check(t, err)
	_, err = store.Save(ctx, "snippet", input())
	check(t, err)
	first, err := store.BeginReview(ctx, request("snippet"))
	check(t, err)
	second, err := store.BeginReview(ctx, request("snippet"))
	check(t, err)
	if err := completeReview(store, ctx, "snippet", first, result("old")); !errors.Is(err, ErrConflict) {
		t.Fatal("superseded review accepted")
	}
	_, err = store.FailReview(ctx, "snippet", second)
	check(t, err)
	_, err = store.BeginReview(ctx, request("snippet"))
	check(t, err)
	check(t, store.Close())
	store, err = Open(path)
	check(t, err)
	defer func() { _ = store.Close() }()
	snippets, err := store.List(ctx)
	check(t, err)
	if snippets[0].ReviewStatus != api.Failed {
		t.Fatal("interrupted review remains running")
	}
}

func TestFixRevisionAndDecisionScope(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	_, err := store.Save(ctx, "snippet", input())
	check(t, err)
	token, err := store.BeginReview(ctx, request("snippet"))
	check(t, err)
	check(t, completeReview(store, ctx, "snippet", token, result("review1")))
	snippets, err := store.List(ctx)
	check(t, err)
	saved := snippets[0]
	states := saved.Review.FindingStates
	state := states["f1"]
	state.Status = api.SavedFindingStateStatusAccepted
	state.GuideState = api.SavedFindingStateGuideStateResolved
	states["f1"] = state
	revised, err := store.SaveReviewState(ctx, saved.Id, api.SaveReviewStateRequest{ExpectedVersion: saved.Version, ExpectedCode: saved.Code, Code: "return nil", Review: *saved.Review})
	check(t, err)
	if revised.Review.FindingStates["f1"].Status != api.SavedFindingStateStatusAccepted || revised.ReviewStatus != api.Stale {
		t.Fatal("fix state was lost")
	}
	_, err = store.Decide(ctx, saved.Id, "f1", api.FindingDecisionRequest{ReviewId: "another-review", Status: api.FindingDecisionRequestStatusDismissed})
	if !errors.Is(err, ErrConflict) {
		t.Fatal("decision applied to wrong review")
	}
	_, err = store.Decide(ctx, saved.Id, "missing", api.FindingDecisionRequest{ReviewId: "review1", Status: api.FindingDecisionRequestStatusDismissed})
	if !errors.Is(err, ErrNotFound) {
		t.Fatal("unknown finding accepted")
	}
}

func completeReview(store *Store, ctx context.Context, id, token string, result api.ReviewResponse) error {
	_, err := store.CompleteReview(ctx, id, token, result)
	return err
}

func TestPartialGuidesPersistAndRejectSupersededProgress(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	_, err := store.Save(ctx, "snippet", input())
	check(t, err)
	token, err := store.BeginReview(ctx, request("snippet"))
	check(t, err)
	partial := result("review1")
	phase := api.Detailing
	partial.Phase = &phase
	pending := api.ReviewFindingDetailStatusPending
	partial.Findings[0].DetailStatus = &pending
	ready := partial.Findings[0]
	ready.Id = "f2"
	status := api.ReviewFindingDetailStatusReady
	ready.DetailStatus = &status
	partial.Findings = append(partial.Findings, ready)
	saved, err := store.ProgressReview(ctx, "snippet", token, partial, false)
	check(t, err)
	if saved.ReviewStatus != api.Reviewing || len(saved.Review.Result.Findings) != 2 {
		t.Fatal("partial review not persisted")
	}
	failed, err := store.FailReview(ctx, "snippet", token)
	check(t, err)
	if *failed.Review.Result.Findings[0].DetailStatus != api.ReviewFindingDetailStatusFailed || *failed.Review.Result.Findings[1].DetailStatus != api.ReviewFindingDetailStatusReady {
		t.Fatal("failed review lost ready guides or retained pending guides")
	}
	_, err = store.ProgressReview(ctx, "snippet", token, partial, true)
	if !errors.Is(err, ErrConflict) {
		t.Fatal("late progress overwrote a failed run")
	}
	token, err = store.BeginReview(ctx, request("snippet"))
	check(t, err)
	saved, err = store.ProgressReview(ctx, "snippet", token, partial, false)
	check(t, err)
	edited := input()
	edited.Code = "return nil"
	edited.ExpectedVersion = &saved.Version
	_, err = store.Save(ctx, "snippet", edited)
	check(t, err)
	_, err = store.ProgressReview(ctx, "snippet", token, partial, true)
	if !errors.Is(err, ErrConflict) {
		t.Fatal("late progress overwrote edited source")
	}
}

func TestRestartRetainsReadyGuidesAndFailsPendingOnes(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "workspace.db")
	store, err := Open(path)
	check(t, err)
	_, err = store.Save(ctx, "snippet", input())
	check(t, err)
	token, err := store.BeginReview(ctx, request("snippet"))
	check(t, err)
	partial := result("review1")
	pending := api.ReviewFindingDetailStatusPending
	partial.Findings[0].DetailStatus = &pending
	_, err = store.ProgressReview(ctx, "snippet", token, partial, false)
	check(t, err)
	check(t, store.Close())
	store, err = Open(path)
	check(t, err)
	defer func() { _ = store.Close() }()
	snippets, err := store.List(ctx)
	check(t, err)
	if snippets[0].ReviewStatus != api.Failed || *snippets[0].Review.Result.Findings[0].DetailStatus != api.ReviewFindingDetailStatusFailed {
		t.Fatal("interrupted guide still pending after restart")
	}
}
