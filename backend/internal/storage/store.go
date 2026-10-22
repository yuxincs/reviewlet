// Package storage persists the single-user workspace in SQLite.
package storage

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/yuxincs/reviewlet/backend/internal/api"
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

var (
	ErrNotFound = errors.New("snippet or finding not found")
	ErrConflict = errors.New("the snippet changed; reload it before trying again")
	ErrInvalid  = errors.New("invalid workspace state")
)

type Store struct{ db *sql.DB }

func Open(path string) (*Store, error) {
	if path == "" {
		return nil, fmt.Errorf("database path is empty")
	}
	dsn := ":memory:"
	if path != ":memory:" {
		absolute, err := filepath.Abs(path)
		if err != nil {
			return nil, err
		}
		if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
			return nil, err
		}
		// Create private files before SQLite opens them. Never truncate an existing database.
		file, err := os.OpenFile(absolute, os.O_CREATE|os.O_RDWR, 0o600)
		if err != nil {
			return nil, err
		}
		if err := file.Close(); err != nil {
			return nil, err
		}
		dsn = (&url.URL{Scheme: "file", Path: absolute}).String()
	}
	dsn += "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	store := &Store{db: db}
	if err := store.initialize(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) initialize() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var version int
	if err := tx.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version > 1 {
		return fmt.Errorf("database schema %d is newer than supported schema 1", version)
	}
	if version == 0 {
		migration, err := migrations.ReadFile("migrations/001_workspace.sql")
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, string(migration)); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "PRAGMA user_version = 1"); err != nil {
			return err
		}
	}
	// Synchronous reviews cannot resume after process termination.
	if _, err := tx.ExecContext(ctx, `UPDATE snippets SET document=json_set(document, '$.reviewStatus', 'failed', '$.version', version+1), version=version+1, review_run='' WHERE review_run<>''`); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) List(ctx context.Context) ([]api.SavedSnippet, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT document FROM snippets ORDER BY json_extract(document, '$.createdAt') DESC, id")
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	result := []api.SavedSnippet{}
	for rows.Next() {
		var data []byte
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		var snippet api.SavedSnippet
		if err := json.Unmarshal(data, &snippet); err != nil {
			return nil, err
		}
		result = append(result, snippet)
	}
	return result, rows.Err()
}

func (s *Store) Delete(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM snippets WHERE id=?", id)
	return err
}

// mutate serializes a read/modify/write and checks versions inside the transaction.
func (s *Store) mutate(ctx context.Context, id string, expected *int, create bool, change func(*api.SavedSnippet, *string) error) (api.SavedSnippet, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return api.SavedSnippet{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var data []byte
	var version int
	var run string
	err = tx.QueryRowContext(ctx, "SELECT document, version, review_run FROM snippets WHERE id=?", id).Scan(&data, &version, &run)
	exists := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return api.SavedSnippet{}, err
	}
	if !exists && !create {
		return api.SavedSnippet{}, ErrNotFound
	}
	if (exists && (expected != nil && *expected != version)) || (!exists && expected != nil) || (exists && create && expected == nil) {
		return api.SavedSnippet{}, ErrConflict
	}
	snippet := api.SavedSnippet{Id: id, CreatedAt: time.Now().UTC()}
	if exists {
		if err := json.Unmarshal(data, &snippet); err != nil {
			return snippet, err
		}
	}
	if err := change(&snippet, &run); err != nil {
		return api.SavedSnippet{}, err
	}
	snippet.Version = version + 1
	snippet.UpdatedAt = time.Now().UTC()
	encoded, err := json.Marshal(snippet)
	if err != nil {
		return snippet, err
	}
	if exists {
		_, err = tx.ExecContext(ctx, "UPDATE snippets SET document=?,version=?,review_run=? WHERE id=?", string(encoded), snippet.Version, run, id)
	} else {
		_, err = tx.ExecContext(ctx, "INSERT INTO snippets(id,document,version,review_run) VALUES(?,?,?,?)", id, string(encoded), snippet.Version, run)
	}
	if err != nil {
		return snippet, err
	}
	return snippet, tx.Commit()
}

func (s *Store) Save(ctx context.Context, id string, input api.SaveSnippetRequest) (api.SavedSnippet, error) {
	return s.mutate(ctx, id, input.ExpectedVersion, true, func(snippet *api.SavedSnippet, run *string) error {
		if input.InitialReview != nil && snippet.Version != 0 {
			return ErrInvalid
		}
		if input.InitialCreatedAt != nil {
			if snippet.Version != 0 {
				return ErrInvalid
			}
			snippet.CreatedAt = *input.InitialCreatedAt
		}
		changed := snippet.Code != input.Code || string(snippet.Language) != string(input.Language) || snippet.Context != input.Context
		if snippet.Version == 0 {
			snippet.ReviewStatus = api.Draft
		}
		if changed {
			if snippet.Review != nil {
				snippet.ReviewStatus = api.Stale
			} else {
				snippet.ReviewStatus = api.Draft
			}
			snippet.Review = nil
			*run = ""
		}
		snippet.Title = strings.TrimSpace(input.Title)
		if snippet.Title == "" {
			snippet.Title = "Untitled snippet"
		}
		snippet.Code = input.Code
		snippet.Context = input.Context
		snippet.Language = api.SavedSnippetLanguage(input.Language)
		if input.LanguageMode != nil {
			mode := api.SavedSnippetLanguageMode(*input.LanguageMode)
			snippet.LanguageMode = &mode
		} else if snippet.LanguageMode == nil {
			mode := api.SavedSnippetLanguageMode("auto")
			snippet.LanguageMode = &mode
		}
		if input.InitialReview != nil {
			if err := validReviewState(*input.InitialReview); err != nil {
				return err
			}
			snippet.Review = input.InitialReview
			snippet.ReviewStatus = api.Reviewed
			hash := sha256.Sum256([]byte(input.Code))
			if hex.EncodeToString(hash[:]) != snippet.Review.Result.CodeHash {
				snippet.ReviewStatus = api.Stale
			}
		}
		return nil
	})
}

func (s *Store) BeginReview(ctx context.Context, request api.ReviewRequest) (string, error) {
	token := rand.Text()
	_, err := s.mutate(ctx, *request.SnippetId, nil, false, func(snippet *api.SavedSnippet, run *string) error {
		language := ""
		if request.Language != nil {
			language = *request.Language
		}
		context := ""
		if request.Context != nil {
			context = *request.Context
		}
		if snippet.Code != request.Code || (request.Language != nil && string(snippet.Language) != language) || snippet.Context != context {
			return ErrConflict
		}
		snippet.ReviewStatus = api.Reviewing
		*run = token
		return nil
	})
	return token, err
}

func (s *Store) CompleteReview(ctx context.Context, id, token string, result api.ReviewResponse) error {
	_, err := s.mutate(ctx, id, nil, false, func(snippet *api.SavedSnippet, run *string) error {
		if *run != token {
			return ErrConflict
		}
		states := map[string]api.SavedFindingState{}
		for _, finding := range result.Findings {
			states[finding.Id] = api.SavedFindingState{Status: api.SavedFindingStateStatusOpen, GuideState: api.SavedFindingStateGuideStateCurrent, Comments: []api.SavedComment{}}
		}
		snippet.Review = &api.SavedReview{Result: result, FindingStates: states}
		snippet.ReviewStatus = api.Reviewed
		*run = ""
		return nil
	})
	return err
}

func (s *Store) FailReview(ctx context.Context, id, token string) error {
	_, err := s.mutate(ctx, id, nil, false, func(snippet *api.SavedSnippet, run *string) error {
		if *run != token {
			return ErrConflict
		}
		snippet.ReviewStatus = api.Failed
		*run = ""
		return nil
	})
	return err
}

func (s *Store) SaveReviewState(ctx context.Context, id string, input api.SaveReviewStateRequest) (api.SavedSnippet, error) {
	return s.mutate(ctx, id, &input.ExpectedVersion, false, func(snippet *api.SavedSnippet, run *string) error {
		if snippet.Code != input.ExpectedCode || snippet.Review == nil || snippet.Review.Result.Id != input.Review.Result.Id || *run != "" {
			return ErrConflict
		}
		if err := validReviewState(input.Review); err != nil {
			return err
		}
		// Preserve server-owned analysis identity even after source locations are remapped.
		input.Review.Result.Id = snippet.Review.Result.Id
		input.Review.Result.CreatedAt = snippet.Review.Result.CreatedAt
		input.Review.Result.CodeHash = snippet.Review.Result.CodeHash
		input.Review.Result.Language = snippet.Review.Result.Language
		snippet.Code = input.Code
		snippet.Review = &input.Review
		hash := sha256.Sum256([]byte(input.Code))
		snippet.ReviewStatus = api.Stale
		if hex.EncodeToString(hash[:]) == snippet.Review.Result.CodeHash {
			snippet.ReviewStatus = api.Reviewed
		}
		return nil
	})
}

func validReviewState(review api.SavedReview) error {
	if len(review.FindingStates) != len(review.Result.Findings) {
		return ErrInvalid
	}
	seen := map[string]bool{}
	for _, finding := range review.Result.Findings {
		if seen[finding.Id] {
			return ErrInvalid
		}
		seen[finding.Id] = true
		if _, ok := review.FindingStates[finding.Id]; !ok {
			return ErrInvalid
		}
	}
	return nil
}

func (s *Store) Decide(ctx context.Context, id, findingID string, input api.FindingDecisionRequest) (api.SavedSnippet, error) {
	return s.mutate(ctx, id, nil, false, func(snippet *api.SavedSnippet, _ *string) error {
		if snippet.Review == nil || snippet.Review.Result.Id != input.ReviewId {
			return ErrConflict
		}
		state, ok := snippet.Review.FindingStates[findingID]
		if !ok {
			return ErrNotFound
		}
		state.Status = api.SavedFindingStateStatus(input.Status)
		snippet.Review.FindingStates[findingID] = state
		return nil
	})
}
