// Package web serves the production frontend alongside the review API.
package web

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Handler keeps API requests on their existing handler, including streaming
// responses. The directory must be the public Vite build output, not its source.
func Handler(api http.Handler, directory string) (http.Handler, error) {
	index, err := os.Stat(filepath.Join(directory, "index.html"))
	if err != nil {
		return nil, fmt.Errorf("frontend build missing; run make frontend-build: %w", err)
	}
	if !index.Mode().IsRegular() {
		return nil, fmt.Errorf("frontend index.html must be a regular file")
	}
	files := http.FileServer(http.Dir(directory))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
			api.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		// Evaluations may rebuild frequently; revalidate the shell and its assets.
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		files.ServeHTTP(w, r)
	}), nil
}
