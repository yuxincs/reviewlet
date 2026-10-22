package review

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/yuxincs/reviewlet/backend/internal/api"
	"github.com/yuxincs/reviewlet/backend/internal/logging"
)

const maxProviderBody = 2 << 20

type provider struct {
	logger *slog.Logger
	config Config
	client *http.Client
	schema string
}

func (p *provider) generate(ctx context.Context, request api.ReviewRequest) (output []byte, err error) {
	started := time.Now()
	logger := logging.FromContext(ctx, p.logger).With("model", p.config.Model)
	logger.InfoContext(ctx, "provider_request_started", "max_completion_tokens", p.config.MaxCompletionTokens)
	status := 0
	stage := "build_request"
	defer func() {
		fields := []any{"duration_ms", float64(time.Since(started).Microseconds()) / 1000, "upstream_status", status}
		if err != nil {
			fields = append(fields, "stage", stage, "error_code", asResponse(err).code)
			level := slog.LevelWarn
			if asResponse(err).status >= 500 {
				level = slog.LevelError
			}
			logger.Log(ctx, level, "provider_request_failed", fields...)
		} else {
			logger.InfoContext(ctx, "provider_request_completed", fields...)
		}
	}()
	messages, err := reviewMessages(request)
	if err != nil {
		return nil, internalError()
	}
	type jsonSchemaFormat struct {
		Name   string          `json:"name"`
		Strict bool            `json:"strict"`
		Schema json.RawMessage `json:"schema"`
	}
	payload, err := json.Marshal(struct {
		Model          string    `json:"model"`
		Messages       []message `json:"messages"`
		ResponseFormat struct {
			Type       string           `json:"type"`
			JSONSchema jsonSchemaFormat `json:"json_schema"`
		} `json:"response_format"`
		MaxCompletionTokens int    `json:"max_completion_tokens"`
		ReasoningEffort     string `json:"reasoning_effort"`
		Store               bool   `json:"store"`
	}{
		Model: p.config.Model, Messages: messages,
		ResponseFormat: struct {
			Type       string           `json:"type"`
			JSONSchema jsonSchemaFormat `json:"json_schema"`
		}{Type: "json_schema", JSONSchema: jsonSchemaFormat{
			Name: "snippet_review", Strict: true, Schema: json.RawMessage(p.schema),
		}},
		MaxCompletionTokens: p.config.MaxCompletionTokens, Store: false,
		ReasoningEffort: "low",
	})
	if err != nil {
		return nil, internalError()
	}
	endpoint := strings.TrimRight(p.config.BaseURL, "/") + "/chat/completions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, internalError()
	}
	req.Header.Set("Authorization", "Bearer "+p.config.APIKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	stage = "send_request"
	response, err := p.client.Do(req)
	if err != nil {
		return nil, transportError(err)
	}
	defer func() { _ = response.Body.Close() }()
	status = response.StatusCode
	stage = "http_status"
	if response.StatusCode != http.StatusOK {
		return nil, providerStatusError(response)
	}
	stage = "read_response"
	data, err := io.ReadAll(io.LimitReader(response.Body, maxProviderBody+1))
	if err != nil {
		return nil, transportError(err)
	}
	if len(data) > maxProviderBody {
		return nil, failedReview()
	}
	stage = "decode_envelope"
	var completion struct {
		Choices []struct {
			FinishReason string `json:"finish_reason"`
			Message      struct {
				Content string  `json:"content"`
				Refusal *string `json:"refusal"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &completion); err != nil {
		return nil, failedReview()
	}
	stage = "validate_completion"
	if len(completion.Choices) != 1 {
		return nil, failedReview()
	}
	choice := completion.Choices[0]
	if choice.FinishReason != "stop" || choice.Message.Refusal != nil || strings.TrimSpace(choice.Message.Content) == "" {
		return nil, failedReview()
	}
	return []byte(choice.Message.Content), nil
}

func transportError(err error) *reviewError {
	var networkError net.Error
	if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &networkError) && networkError.Timeout()) {
		return timeoutReview()
	}
	return unavailableReview()
}

func providerStatusError(response *http.Response) *reviewError {
	switch response.StatusCode {
	case http.StatusTooManyRequests:
		return &reviewError{status: http.StatusTooManyRequests, code: api.ErrorResponseErrorCodeRateLimited, message: "Too many review requests. Try again later.", retryAfter: retryAfter(response.Header.Get("Retry-After"))}
	case http.StatusRequestTimeout, http.StatusGatewayTimeout:
		return timeoutReview()
	case http.StatusUnauthorized, http.StatusForbidden:
		return unavailableReview()
	default:
		if response.StatusCode >= 500 {
			err := unavailableReview()
			if response.Header.Get("Retry-After") != "" {
				err.retryAfter = retryAfter(response.Header.Get("Retry-After"))
			}
			return err
		}
		return failedReview()
	}
}

func retryAfter(value string) int {
	seconds, err := strconv.Atoi(value)
	if err != nil {
		when, dateErr := http.ParseTime(value)
		if dateErr != nil {
			return 1
		}
		seconds = int(time.Until(when).Seconds()) + 1
	}
	return min(86400, max(1, seconds))
}
