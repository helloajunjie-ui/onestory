package ai

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strings"

	"ink-tavern/server/internal/store"
)

// ProxyChatCompletions 转发 /chat/completions 到 OpenAI 兼容上游。
// cfg 为 AI 配置；body 为前端原始请求体（model 已由调用方注入）；stream 决定流式/非流式。
func ProxyChatCompletions(w http.ResponseWriter, r *http.Request, cfg store.AIConfig, body []byte, stream bool) {
	if cfg.APIKey == "" {
		writeErr(w, http.StatusBadRequest, "API Key 未配置，请在设置中填写")
		return
	}

	baseURL := strings.TrimRight(cfg.BaseURL, "/")
	upstream, err := http.NewRequestWithContext(r.Context(), http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "构建上游请求失败")
		return
	}
	upstream.Header.Set("Content-Type", "application/json")
	upstream.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	resp, err := http.DefaultClient.Do(upstream)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "网络连接失败，请检查 BaseURL 是否正确")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 65536))
		status, msg := mapUpstreamError(resp.StatusCode, string(errBody))
		writeErr(w, status, msg)
		return
	}

	if stream {
		forwardSSE(w, resp)
		return
	}
	// 非流式：原样转发上游 JSON
	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	if resp.Header.Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/json")
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, resp.Body)
}

// ProxyModels 转发 GET /models 并归一化为去重排序的模型 id 数组。
func ProxyModels(w http.ResponseWriter, r *http.Request, cfg store.AIConfig) {
	if cfg.APIKey == "" {
		writeJSON(w, http.StatusOK, []string{})
		return
	}

	baseURL := strings.TrimRight(cfg.BaseURL, "/")
	upstream, err := http.NewRequestWithContext(r.Context(), http.MethodGet, baseURL+"/models", nil)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "构建上游请求失败")
		return
	}
	upstream.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	resp, err := http.DefaultClient.Do(upstream)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "网络连接失败，请检查 BaseURL 是否正确")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 65536))
		status, msg := mapUpstreamError(resp.StatusCode, string(errBody))
		writeErr(w, status, msg)
		return
	}

	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&payload)

	set := make(map[string]bool)
	for _, m := range payload.Data {
		if m.ID != "" {
			set[m.ID] = true
		}
	}
	list := make([]string, 0, len(set))
	for id := range set {
		list = append(list, id)
	}
	sort.Strings(list)
	writeJSON(w, http.StatusOK, list)
}

// forwardSSE 逐 chunk 转发上游 SSE 流。
// 关键：每个 chunk 后强制 Flush，否则前端只能一次性收到全部内容；
// 使用 r.Context() 创建的请求，前端 abort 时上游请求自动中断。
func forwardSSE(w http.ResponseWriter, resp *http.Response) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // 防 nginx 缓冲
	w.WriteHeader(http.StatusOK)

	rc := http.NewResponseController(w)
	buf := make([]byte, 8192)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return // 客户端断连
			}
			_ = rc.Flush()
		}
		if err != nil {
			return
		}
	}
}

// mapUpstreamError 将上游 HTTP 错误映射为中文提示，避免透传上游密钥细节。
func mapUpstreamError(status int, errBody string) (int, string) {
	switch status {
	case http.StatusUnauthorized:
		return http.StatusUnauthorized, "API Key 无效或未授权，请检查配置"
	case http.StatusNotFound:
		return http.StatusNotFound, "API 端点不存在，请检查 BaseURL 是否正确"
	case http.StatusTooManyRequests:
		return http.StatusTooManyRequests, "请求过于频繁，请稍后重试"
	}
	if status >= 500 {
		return http.StatusBadGateway, "上游 AI 服务错误，请稍后重试"
	}
	snippet := strings.TrimSpace(errBody)
	if len(snippet) > 200 {
		snippet = snippet[:200]
	}
	if snippet == "" {
		snippet = "上游请求失败"
	}
	return status, snippet
}

// writeJSON / writeErr（ai 包内小助手，避免与 api 包循环依赖）
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
