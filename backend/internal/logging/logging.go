// Package logging provides structured logs and server-generated request IDs.
package logging

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

func New(writer io.Writer, level string) (*slog.Logger, error) {
	severity := slog.LevelInfo
	if strings.TrimSpace(level) != "" {
		if err := severity.UnmarshalText([]byte(strings.TrimSpace(level))); err != nil {
			return nil, fmt.Errorf("LOG_LEVEL must be debug, info, warn, or error")
		}
	}
	return slog.New(slog.NewJSONHandler(writer, &slog.HandlerOptions{Level: severity})).With("service", "reviewlet-backend"), nil
}

type contextKey struct{}

func FromContext(ctx context.Context, fallback *slog.Logger) *slog.Logger {
	if logger, ok := ctx.Value(contextKey{}).(*slog.Logger); ok {
		return logger
	}
	if fallback != nil {
		return fallback
	}
	return slog.Default()
}

func Middleware(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		// Always generate our own ID instead of trusting arbitrary incoming values.
		requestID := rand.Text()
		logger := logger.With("request_id", requestID)
		r = r.WithContext(context.WithValue(r.Context(), contextKey{}, logger))
		w.Header().Set("X-Request-ID", requestID)
		response := &responseWriter{ResponseWriter: w}
		completed := false
		defer func() {
			status := response.status
			if status == 0 {
				status = http.StatusOK
			}
			if !completed {
				status = http.StatusInternalServerError
			}
			route := r.Pattern
			if route == "" {
				route = "unmatched"
			}
			level := slog.LevelInfo
			if status >= 500 {
				level = slog.LevelError
			} else if status >= 400 {
				level = slog.LevelWarn
			}
			// Log the matched pattern, not URLs, query strings, or arbitrary paths.
			logger.Log(r.Context(), level, "http_request_completed",
				"method", r.Method, "route", route, "status", status,
				"duration_ms", float64(time.Since(started).Microseconds())/1000,
				"response_bytes", response.bytes)
		}()
		next.ServeHTTP(response, r)
		completed = true
	})
}

type responseWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *responseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *responseWriter) WriteHeader(status int) {
	if status >= 100 && status < 200 {
		w.ResponseWriter.WriteHeader(status)
		return
	}
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *responseWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	count, err := w.ResponseWriter.Write(data)
	w.bytes += count
	return count, err
}
