package api

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"ink-tavern/server/internal/store"
)

// shareCodeChars 分享码字符集（base62）
const shareCodeChars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// generateShareCode 生成 8 位随机分享码
func generateShareCode() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	for i := range b {
		b[i] = shareCodeChars[int(b[i])%len(shareCodeChars)]
	}
	return string(b)
}

// handleCreateShare 生成剧本分享码（快照式，云端预留）
func handleCreateShare(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ScriptID string `json:"scriptId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ScriptID == "" {
			writeError(w, http.StatusBadRequest, "scriptId 必填")
			return
		}
		script, err := st.GetScript(req.ScriptID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		code := generateShareCode()
		scriptJSON := mustJSON(script)
		if err := st.CreateShare(code, req.ScriptID, scriptJSON, time.Now().UnixMilli()); err != nil {
			writeError(w, http.StatusInternalServerError, "生成分享失败")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{
			"code": code,
			"url":  "/share/" + code,
		})
	}
}

// handleGetShare 读取分享快照（返回完整 Script）
func handleGetShare(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sh, err := st.GetShare(r.PathValue("code"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		var script store.Script
		if err := json.Unmarshal([]byte(sh.Script), &script); err != nil {
			writeError(w, http.StatusInternalServerError, "分享数据解析失败")
			return
		}
		writeJSON(w, http.StatusOK, script)
	}
}

// handleDownloadShare 下载分享剧本为 .ink.json
func handleDownloadShare(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sh, err := st.GetShare(r.PathValue("code"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		var script store.Script
		if err := json.Unmarshal([]byte(sh.Script), &script); err != nil {
			writeError(w, http.StatusInternalServerError, "分享数据解析失败")
			return
		}
		pack := map[string]any{
			"version":    1,
			"type":       "ink-tavern-script",
			"exportedAt": time.Now().UnixMilli(),
			"data":       script,
		}
		body, err := json.MarshalIndent(pack, "", "  ")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "序列化分享数据失败")
			return
		}
		filename := script.Meta.Title
		if filename == "" {
			filename = "script"
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s.ink.json", filename))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}
}
