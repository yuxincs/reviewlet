package review

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/yuxincs/reviewlet/backend/internal/api"
)

func (s *Service) streamReview(w http.ResponseWriter, r *http.Request, input api.ReviewRequest) {
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	controller := http.NewResponseController(w)
	if _, err := fmt.Fprint(w, ": connected\n\n"); err != nil {
		return
	}
	if controller.Flush() != nil {
		return
	}
	type event struct {
		name string
		data []byte
	}
	requestID := w.Header().Get("X-Request-ID")
	events := make(chan event, 1)
	go func() {
		defer close(events)
		err := s.stagedReview(ctx, input, func(snapshot api.ReviewResponse) error {
			name := "progress"
			if snapshot.Phase != nil && *snapshot.Phase == api.Complete {
				name = "complete"
			}
			data, err := json.Marshal(snapshot)
			if err != nil {
				return internalError()
			}
			select {
			case events <- event{name, data}:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		})
		if err != nil {
			problem := asResponse(err)
			body := api.ErrorResponse{}
			body.Error.Code = problem.code
			body.Error.Message = problem.message
			body.Error.SnippetVersion = problem.snippetVersion
			if requestID != "" {
				body.Error.RequestId = &requestID
			}
			data, _ := json.Marshal(body)
			select {
			case events <- event{"error", data}:
			case <-ctx.Done():
			}
		}
	}()
	heartbeat := time.NewTicker(10 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": heartbeat\n\n"); err != nil {
				return
			}
			if controller.Flush() != nil {
				return
			}
		case next, ok := <-events:
			if !ok {
				return
			}
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", next.name, next.data); err != nil {
				return
			}
			if controller.Flush() != nil {
				return
			}
		}
	}
}
