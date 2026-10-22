package review

import (
	"testing"
	"time"
)

func configEnvironment(t *testing.T) {
	t.Helper()
	t.Setenv("OPENAI_API_KEY", "test-key")
	t.Setenv("OPENAI_MODEL", "")
	for _, key := range []string{"OPENAI_BASE_URL", "REVIEW_TIMEOUT", "OPENAI_MAX_COMPLETION_TOKENS"} {
		t.Setenv(key, "")
	}
}

func TestLoadConfig(t *testing.T) {
	configEnvironment(t)
	config, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if config.Model != "gpt-6.1-sol" || config.BaseURL != "https://api.openai.com/v1" || config.Timeout != 90*time.Second || config.MaxCompletionTokens != 16384 {
		t.Fatalf("unexpected defaults: %+v", config)
	}
	t.Setenv("OPENAI_MODEL", "override-model")
	t.Setenv("OPENAI_BASE_URL", "http://localhost:1234/custom/v1/")
	t.Setenv("REVIEW_TIMEOUT", "30s")
	t.Setenv("OPENAI_MAX_COMPLETION_TOKENS", "2048")
	config, err = LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if config.Model != "override-model" || config.Timeout != 30*time.Second || config.MaxCompletionTokens != 2048 {
		t.Fatal("configuration overrides ignored")
	}
}

func TestInvalidConfig(t *testing.T) {
	for _, tc := range []struct{ key, value string }{
		{"OPENAI_API_KEY", ""}, {"OPENAI_API_KEY", "bad\r\nkey"},
		{"OPENAI_BASE_URL", "file:///tmp/api"}, {"OPENAI_BASE_URL", "https://user:provider-secret@host/v1"},
		{"OPENAI_BASE_URL", "https://host/v1?key=provider-secret"}, {"OPENAI_BASE_URL", "https://host/v1#fragment"},
		{"REVIEW_TIMEOUT", "0s"}, {"REVIEW_TIMEOUT", "-1s"}, {"REVIEW_TIMEOUT", "invalid"},
		{"OPENAI_MAX_COMPLETION_TOKENS", "0"}, {"OPENAI_MAX_COMPLETION_TOKENS", "-1"}, {"OPENAI_MAX_COMPLETION_TOKENS", "invalid"},
	} {
		t.Run(tc.key+"/"+tc.value, func(t *testing.T) {
			configEnvironment(t)
			t.Setenv(tc.key, tc.value)
			if _, err := LoadConfig(); err == nil {
				t.Fatal("invalid configuration accepted")
			}
		})
	}
}

func TestRetryAfter(t *testing.T) {
	for _, tc := range []struct {
		input    string
		expected int
	}{{"", 1}, {"-1", 1}, {"0", 1}, {"7", 7}, {"invalid", 1}, {"999999", 86400}} {
		if got := retryAfter(tc.input); got != tc.expected {
			t.Errorf("retryAfter(%q) = %d, want %d", tc.input, got, tc.expected)
		}
	}
	seconds := retryAfter(time.Now().Add(30 * time.Second).UTC().Format("Mon, 02 Jan 2006 15:04:05 GMT"))
	if seconds < 29 || seconds > 31 {
		t.Fatalf("HTTP date retry delay = %d", seconds)
	}
}
