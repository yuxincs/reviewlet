package web

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProductionFrontendAndAPI(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "assets"), 0o700); err != nil {
		t.Fatal(err)
	}
	for path, body := range map[string]string{"index.html": "<!doctype html><h1>Reviewlet</h1>", "assets/app.js": "console.log('production');", "assets/parser.wasm": "wasm"} {
		if err := os.WriteFile(filepath.Join(dir, path), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	api := http.NewServeMux()
	api.HandleFunc("/api/v1/snippets", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, "[]")
	})
	api.HandleFunc("POST /api/v1/review", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "event: progress\ndata: {}\n\n")
		if err := http.NewResponseController(w).Flush(); err != nil {
			t.Error(err)
		}
	})
	handler, err := Handler(api, dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		method, path      string
		status            int
		contentType, body string
	}{
		{"GET", "/", 200, "text/html", "Reviewlet"},
		{"GET", "/assets/app.js", 200, "javascript", "production"},
		{"GET", "/assets/parser.wasm", 200, "application/wasm", "wasm"},
		{"HEAD", "/", 200, "text/html", ""},
		{"GET", "/api/v1/snippets", 200, "application/json", "[]"},
		{"POST", "/api/v1/review", 200, "text/event-stream", "event: progress"},
		{"GET", "/api/missing", 404, "text/plain", "404"},
		{"GET", "/assets/missing.js", 404, "text/plain", "404"},
		{"POST", "/", 405, "text/plain", "Method not allowed"},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(tc.method, tc.path, nil))
			if response.Code != tc.status || !strings.Contains(response.Header().Get("Content-Type"), tc.contentType) || !strings.Contains(response.Body.String(), tc.body) {
				t.Fatalf("unexpected response: %d %v %s", response.Code, response.Header(), response.Body.String())
			}
			if tc.method == "HEAD" && response.Body.Len() != 0 {
				t.Fatal("HEAD returned a body")
			}
		})
	}
}

func TestRejectMissingFrontendBuild(t *testing.T) {
	if _, err := Handler(http.NotFoundHandler(), t.TempDir()); err == nil {
		t.Fatal("accepted missing index.html")
	}
}
