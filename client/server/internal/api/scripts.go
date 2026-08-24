package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"ink-tavern/server/internal/store"
)

func handleCreateScript(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var script store.Script
		if err := json.NewDecoder(r.Body).Decode(&script); err != nil {
			writeError(w, http.StatusBadRequest, "请求体解析失败")
			return
		}
		id, err := st.CreateScript(script)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "创建剧本失败")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"id": id})
	}
}

func handleListScripts(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := st.ListScripts()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取剧本列表失败")
			return
		}
		writeJSON(w, http.StatusOK, list)
	}
}

func handleGetScript(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		script, err := st.GetScript(r.PathValue("id"))
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "剧本不存在")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取剧本失败")
			return
		}
		writeJSON(w, http.StatusOK, script)
	}
}

func handleUpdateScript(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var patch map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
			writeError(w, http.StatusBadRequest, "请求体解析失败")
			return
		}
		if len(patch) == 0 {
			writeError(w, http.StatusBadRequest, "更新内容为空")
			return
		}
		if err := st.UpdateScript(r.PathValue("id"), patch); err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func handleDeleteScript(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := st.DeleteScript(r.PathValue("id")); err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// writeStoreError 统一转换 store 错误为 HTTP 响应
func writeStoreError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "记录不存在")
		return
	}
	writeError(w, http.StatusInternalServerError, "存储操作失败")
}
