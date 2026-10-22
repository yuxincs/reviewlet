package review

import (
	"embed"
	"encoding/json"
	"strings"

	"github.com/yuxincs/reviewlet/backend/internal/api"
)

//go:embed prompts/*.txt
var promptFS embed.FS

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func reviewMessages(request api.ReviewRequest) ([]message, error) {
	prompt, err := promptFS.ReadFile("prompts/review.txt")
	if err != nil {
		return nil, err
	}
	type sourceLine struct {
		Number int    `json:"number"`
		Text   string `json:"text"`
	}
	lines := strings.Split(request.Code, "\n")
	numbered := make([]sourceLine, len(lines))
	for i, line := range lines {
		numbered[i] = sourceLine{Number: i + 1, Text: line}
	}
	payload, err := json.Marshal(struct {
		Language *string      `json:"language,omitempty"`
		Context  *string      `json:"context,omitempty"`
		Lines    []sourceLine `json:"lines"`
	}{Language: request.Language, Context: request.Context, Lines: numbered})
	if err != nil {
		return nil, err
	}
	return []message{
		{Role: "system", Content: string(prompt)},
		{Role: "user", Content: string(payload)},
	}, nil
}
