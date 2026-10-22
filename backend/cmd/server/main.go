package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/yuxincs/reviewlet/backend/internal/logging"
	"github.com/yuxincs/reviewlet/backend/internal/review"
	"github.com/yuxincs/reviewlet/backend/internal/storage"
	"github.com/yuxincs/reviewlet/backend/internal/web"
)

func main() {
	logger, err := logging.New(os.Stderr, os.Getenv("LOG_LEVEL"))
	if err != nil {
		slog.New(slog.NewJSONHandler(os.Stderr, nil)).Error("server_start_failed", "error", err)
		os.Exit(1)
	}
	if err := run(logger); err != nil {
		logger.Error("server_failed", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	config, err := review.LoadConfig()
	if err != nil {
		return err
	}
	service, err := review.NewService(config, logger)
	if err != nil {
		return fmt.Errorf("initialize review service: %w", err)
	}
	databasePath := os.Getenv("DATABASE_PATH")
	if databasePath == "" {
		databasePath = "data/reviewlet.db"
	}
	store, err := storage.Open(databasePath)
	if err != nil {
		return fmt.Errorf("open workspace database: %w", err)
	}
	defer func() { _ = store.Close() }()
	service.UseStore(store)
	address := os.Getenv("LISTEN_ADDR")
	if address == "" {
		address = ":8080"
	}
	handler := service.Handler()
	if directory := os.Getenv("FRONTEND_DIST"); directory != "" {
		handler, err = web.Handler(handler, directory)
		if err != nil {
			return fmt.Errorf("serve frontend: %w", err)
		}
	}
	server := &http.Server{
		Addr: address, Handler: handler,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelError),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second,
		WriteTimeout: config.Timeout + 10*time.Second, IdleTimeout: 60 * time.Second,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	result := make(chan error, 1)
	go func() { result <- server.Serve(listener) }()
	logger.Info("server_started", "address", listener.Addr().String(), "model", config.Model, "detail_model", config.DetailModel, "review_timeout_ms", config.Timeout.Milliseconds())
	if os.Getenv("FRONTEND_DIST") != "" {
		if _, port, err := net.SplitHostPort(listener.Addr().String()); err == nil {
			_, _ = fmt.Fprintf(os.Stdout, "\n\x1b[1mOpen http://localhost:%s in your browser.\x1b[0m\n\n", port)
		}
	}
	select {
	case err := <-result:
		if errors.Is(err, http.ErrServerClosed) {
			logger.Info("server_stopped")
			return nil
		}
		return err
	case <-ctx.Done():
		logger.Info("server_shutdown_started")
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			_ = server.Close()
			return fmt.Errorf("shut down server: %w", err)
		}
		logger.Info("server_stopped")
		return nil
	}
}
