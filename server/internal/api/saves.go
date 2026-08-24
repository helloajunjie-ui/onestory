package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"ink-tavern/server/internal/store"
)

type createSaveRequest struct {
	ScriptID string `json:"scriptId"`
	Name     string `json:"name"`
}

func handleCreateSave(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createSaveRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ScriptID == "" {
			writeError(w, http.StatusBadRequest, "scriptId 必填")
			return
		}
		id, err := st.CreateSave(req.ScriptID, req.Name)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "所属剧本不存在")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "创建存档失败")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"id": id})
	}
}

func handleListSaves(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scriptID := r.URL.Query().Get("scriptId")
		if scriptID == "" {
			writeError(w, http.StatusBadRequest, "scriptId 必填")
			return
		}
		list, err := st.ListSaves(scriptID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取存档列表失败")
			return
		}
		writeJSON(w, http.StatusOK, list)
	}
}

func handleGetSave(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, err := st.GetSave(r.PathValue("id"))
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "存档不存在")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取存档失败")
			return
		}
		writeJSON(w, http.StatusOK, data)
	}
}

func handleUpdateSave(st *store.Store) http.HandlerFunc {
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
		if err := st.UpdateSave(r.PathValue("id"), patch); err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func handleDeleteSave(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := st.DeleteSave(r.PathValue("id")); err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}
