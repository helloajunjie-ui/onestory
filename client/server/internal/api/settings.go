package api

import (
	"crypto/rand"
	"encoding/json"
	"net/http"

	"ink-tavern/server/internal/store"
)

// 默认配置（与旧版 Zustand persist 默认值一致）
var (
	defaultAI = store.AIConfig{
		BaseURL: "https://api.openai.com/v1",
		APIKey:  "",
		Model:   "gpt-3.5-turbo",
		BreakPrompt: "",
	}
	defaultAppearance = store.AppearanceConfig{
		FontSize:      16,
		BubbleOpacity: 40,
		TextColor:     "#e4e4e7",
		HeaderOpacity: 80,
		BgDim:         40,
	}
)

// getConfig 读取 JSON 配置，不存在/损坏时返回默认值
func getConfig[T any](st *store.Store, key string, defaults T) T {
	val, ok, err := st.GetSettingJSON(key)
	if err != nil || !ok {
		return defaults
	}
	var cfg T
	if err := json.Unmarshal([]byte(val), &cfg); err != nil {
		return defaults
	}
	return cfg
}

// mergeConfig 将部分更新 map 合并进现有对象，写回 settings 表
func mergeConfig[T any](st *store.Store, key string, cur T, patch map[string]json.RawMessage, apply func(*T, map[string]json.RawMessage)) error {
	apply(&cur, patch)
	if err := st.SetSettingJSON(key, mustJSON(cur)); err != nil {
		return err
	}
	return nil
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// ==================== AI 配置 ====================

func handleGetAISettings(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, getConfig(st, "ai", defaultAI))
	}
}

func handleUpdateAISettings(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var patch map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil || len(patch) == 0 {
			writeError(w, http.StatusBadRequest, "请求体解析失败或为空")
			return
		}
		cur := getConfig(st, "ai", defaultAI)
		err := mergeConfig(st, "ai", cur, patch, func(c *store.AIConfig, p map[string]json.RawMessage) {
			if raw, ok := p["baseUrl"]; ok {
				_ = json.Unmarshal(raw, &c.BaseURL)
			}
			if raw, ok := p["apiKey"]; ok {
				_ = json.Unmarshal(raw, &c.APIKey)
			}
			if raw, ok := p["model"]; ok {
				_ = json.Unmarshal(raw, &c.Model)
			}
			if raw, ok := p["breakPrompt"]; ok {
				_ = json.Unmarshal(raw, &c.BreakPrompt)
			}
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "保存 AI 配置失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// ==================== 公共剧本库云端配置 ====================

// CloudConfig 云端公共剧本库连接配置
type CloudConfig struct {
	LibraryBaseURL string `json:"libraryBaseUrl"`
}

func handleGetCloudSettings(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, getConfig(st, "cloud", CloudConfig{}))
	}
}

func handleUpdateCloudSettings(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var patch map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil || len(patch) == 0 {
			writeError(w, http.StatusBadRequest, "请求体解析失败或为空")
			return
		}
		cur := getConfig(st, "cloud", CloudConfig{})
		err := mergeConfig(st, "cloud", cur, patch, func(c *CloudConfig, p map[string]json.RawMessage) {
			if raw, ok := p["libraryBaseUrl"]; ok {
				_ = json.Unmarshal(raw, &c.LibraryBaseURL)
			}
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "保存云端配置失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// ==================== 客户端 UID ====================

// newClientUID 生成 10 位随机数字字母（公共剧本库身份标识）
func newClientUID() string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 10)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = chars[int(b[i])%len(chars)]
	}
	return string(b)
}

// handleGetClientUID 获取/生成客户端 UID（首次调用生成并持久化）
func handleGetClientUID(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := getConfig(st, "client_uid", "")
		if uid == "" {
			uid = newClientUID()
			if err := st.SetSettingJSON("client_uid", `"`+uid+`"`); err != nil {
				writeError(w, http.StatusInternalServerError, "生成身份标识失败")
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]string{"uid": uid})
	}
}

// ==================== 外观配置 ====================

func handleGetAppearanceSettings(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, getConfig(st, "appearance", defaultAppearance))
	}
}

func handleUpdateAppearanceSettings(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var patch map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil || len(patch) == 0 {
			writeError(w, http.StatusBadRequest, "请求体解析失败或为空")
			return
		}
		cur := getConfig(st, "appearance", defaultAppearance)
		err := mergeConfig(st, "appearance", cur, patch, func(c *store.AppearanceConfig, p map[string]json.RawMessage) {
			if raw, ok := p["fontSize"]; ok {
				_ = json.Unmarshal(raw, &c.FontSize)
			}
			if raw, ok := p["bubbleOpacity"]; ok {
				_ = json.Unmarshal(raw, &c.BubbleOpacity)
			}
			if raw, ok := p["textColor"]; ok {
				_ = json.Unmarshal(raw, &c.TextColor)
			}
			if raw, ok := p["headerOpacity"]; ok {
				_ = json.Unmarshal(raw, &c.HeaderOpacity)
			}
			if raw, ok := p["bgDim"]; ok {
				_ = json.Unmarshal(raw, &c.BgDim)
			}
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "保存外观配置失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}
