package api

import (
	"encoding/json"
	"io"
	"net/http"

	"ink-tavern/server/internal/ai"
	"ink-tavern/server/internal/store"
)

// handleChatCompletions 前端对话入口：注入配置的 model（若请求未指定），判断 stream，转交代理。
func handleChatCompletions(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cfg := getConfig(st, "ai", defaultAI)

		body, err := io.ReadAll(r.Body)
		if err != nil {
			writeError(w, http.StatusBadRequest, "读取请求体失败")
			return
		}
		var payload map[string]json.RawMessage
		if err := json.Unmarshal(body, &payload); err != nil {
			writeError(w, http.StatusBadRequest, "请求体解析失败")
			return
		}

		// 请求体未指定 model 时注入配置的默认模型
		if _, ok := payload["model"]; !ok {
			payload["model"] = json.RawMessage(mustJSON(cfg.Model))
			body, _ = json.Marshal(payload)
		}

		stream := true
		if raw, ok := payload["stream"]; ok {
			var s bool
			if err := json.Unmarshal(raw, &s); err == nil {
				stream = s
			}
		}

		ai.ProxyChatCompletions(w, r, cfg, body, stream)
	}
}

// handleModels 获取模型列表（经代理）
func handleModels(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cfg := getConfig(st, "ai", defaultAI)
		ai.ProxyModels(w, r, cfg)
	}
}
