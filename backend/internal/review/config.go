package review

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const defaultModel = "gpt-6.1-sol"

type Config struct {
	APIKey              string
	BaseURL             string
	Model               string
	Timeout             time.Duration
	MaxCompletionTokens int
}

func LoadConfig() (Config, error) {
	config := Config{
		APIKey:              strings.TrimSpace(os.Getenv("OPENAI_API_KEY")),
		Model:               strings.TrimSpace(os.Getenv("OPENAI_MODEL")),
		BaseURL:             strings.TrimSpace(os.Getenv("OPENAI_BASE_URL")),
		Timeout:             90 * time.Second,
		MaxCompletionTokens: 16384,
	}
	if config.Model == "" {
		config.Model = defaultModel
	}
	if config.BaseURL == "" {
		config.BaseURL = "https://api.openai.com/v1"
	}
	if value := os.Getenv("REVIEW_TIMEOUT"); value != "" {
		duration, err := time.ParseDuration(value)
		if err != nil {
			return Config{}, fmt.Errorf("REVIEW_TIMEOUT must be a positive duration, e.g. 90s")
		}
		config.Timeout = duration
	}
	if value := os.Getenv("OPENAI_MAX_COMPLETION_TOKENS"); value != "" {
		tokens, err := strconv.Atoi(value)
		if err != nil {
			return Config{}, fmt.Errorf("OPENAI_MAX_COMPLETION_TOKENS must be a positive integer")
		}
		config.MaxCompletionTokens = tokens
	}
	return config, config.validate()
}

func (c Config) validate() error {
	if c.APIKey == "" || strings.ContainsAny(c.APIKey, "\r\n") {
		return fmt.Errorf("OPENAI_API_KEY is required and must be a valid header value")
	}
	if c.Model == "" {
		return fmt.Errorf("OPENAI_MODEL must support Structured Outputs")
	}
	endpoint, err := url.Parse(c.BaseURL)
	if err != nil || endpoint.Host == "" || (endpoint.Scheme != "https" && endpoint.Scheme != "http") || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return fmt.Errorf("OPENAI_BASE_URL must be an http(s) URL without credentials, query, or fragment")
	}
	if c.Timeout <= 0 {
		return fmt.Errorf("REVIEW_TIMEOUT must be positive")
	}
	if c.MaxCompletionTokens <= 0 {
		return fmt.Errorf("OPENAI_MAX_COMPLETION_TOKENS must be positive")
	}
	return nil
}
