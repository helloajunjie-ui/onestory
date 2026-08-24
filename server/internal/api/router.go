package api

import (
	"net/http"

	"ink-tavern/server/internal/store"
)

// NewMux 组装全部路由。
// 注意：所有 API 端点挂 /api 前缀；静态文件托管由 static.go 的根路由处理（阶段 4）。
func NewMux(st *store.Store) *http.ServeMux {
	mux := http.NewServeMux()

	// 健康检查
	mux.HandleFunc("GET /api/health", handleHealth(st))

	// 剧本
	mux.HandleFunc("POST /api/scripts", handleCreateScript(st))
	mux.HandleFunc("GET /api/scripts", handleListScripts(st))
	mux.HandleFunc("GET /api/scripts/{id}", handleGetScript(st))
	mux.HandleFunc("PUT /api/scripts/{id}", handleUpdateScript(st))
	mux.HandleFunc("DELETE /api/scripts/{id}", handleDeleteScript(st))

	// 存档
	mux.HandleFunc("POST /api/saves", handleCreateSave(st))
	mux.HandleFunc("GET /api/saves", handleListSaves(st))
	mux.HandleFunc("GET /api/saves/{id}", handleGetSave(st))
	mux.HandleFunc("PUT /api/saves/{id}", handleUpdateSave(st))
	mux.HandleFunc("DELETE /api/saves/{id}", handleDeleteSave(st))

	// 设置
	mux.HandleFunc("GET /api/settings/ai", handleGetAISettings(st))
	mux.HandleFunc("PUT /api/settings/ai", handleUpdateAISettings(st))
	mux.HandleFunc("GET /api/settings/appearance", handleGetAppearanceSettings(st))
	mux.HandleFunc("PUT /api/settings/appearance", handleUpdateAppearanceSettings(st))
	mux.HandleFunc("GET /api/settings/cloud", handleGetCloudSettings(st))
	mux.HandleFunc("PUT /api/settings/cloud", handleUpdateCloudSettings(st))
	mux.HandleFunc("GET /api/client/uid", handleGetClientUID(st))

	// 资源
	mux.HandleFunc("GET /api/assets", handleLoadAsset(st))
	mux.HandleFunc("PUT /api/assets", handleSaveAsset(st))
	mux.HandleFunc("GET /api/bg-image", handleLoadBgImage(st))
	mux.HandleFunc("PUT /api/bg-image", handleSaveBgImage(st))

	// 备份
	mux.HandleFunc("GET /api/backup/export", handleExportBackup(st))
	mux.HandleFunc("POST /api/backup/import", handleImportBackup(st))

	// AI 代理
	mux.HandleFunc("POST /api/ai/chat/completions", handleChatCompletions(st))
	mux.HandleFunc("GET /api/ai/models", handleModels(st))

	// 分享（云端预留）
	mux.HandleFunc("POST /api/share", handleCreateShare(st))
	mux.HandleFunc("GET /api/share/{code}", handleGetShare(st))
	mux.HandleFunc("GET /api/share/{code}/download", handleDownloadShare(st))

	// 静态托管 + SPA fallback（阶段 4 实现）
	mux.HandleFunc("/", handleStatic())

	return mux
}

func handleHealth(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}
