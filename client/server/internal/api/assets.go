package api

import (
	"encoding/json"
	"net/http"

	"ink-tavern/server/internal/store"
)

// bgImagePath 背景图在 assets 表中的固定 path
const bgImagePath = "__bg_image__"

func handleLoadAsset(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Query().Get("path")
		if path == "" {
			writeError(w, http.StatusBadRequest, "path 必填")
			return
		}
		data, _, _ := st.LoadAsset(path)
		writeJSON(w, http.StatusOK, map[string]string{"data": data})
	}
}

func handleSaveAsset(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Path string `json:"path"`
			Data string `json:"data"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Path == "" {
			writeError(w, http.StatusBadRequest, "path 必填")
			return
		}
		if err := st.SaveAsset(req.Path, req.Data); err != nil {
			writeError(w, http.StatusInternalServerError, "保存资源失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func handleLoadBgImage(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, _, _ := st.LoadAsset(bgImagePath)
		writeJSON(w, http.StatusOK, map[string]string{"data": data})
	}
}

func handleSaveBgImage(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Data string `json:"data"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "请求体解析失败")
			return
		}
		if err := st.SaveAsset(bgImagePath, req.Data); err != nil {
			writeError(w, http.StatusInternalServerError, "保存背景图失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}
