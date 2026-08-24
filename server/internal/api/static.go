package api

import (
	"io/fs"
	"net/http"
	"strings"

	"ink-tavern/server/internal/webui"
)

// handleStatic 托管内嵌的前端产物 + SPA fallback。
// 非 /api 路径优先返回真实文件，未命中时回退 index.html（query 驱动路由）。
func handleStatic() http.HandlerFunc {
	fsys, err := fs.Sub(webui.Dist, "dist")
	if err != nil {
		// 构建产物缺失（开发期），给出明确提示
		return func(w http.ResponseWriter, r *http.Request) {
			writeError(w, http.StatusInternalServerError, "前端构建产物缺失，请先执行 cd web && npm run build")
		}
	}
	fileServer := http.FileServer(http.FS(fsys))

	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			fileServer.ServeHTTP(w, r)
			return
		}
		if f, err := fsys.Open(path); err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}
		// SPA fallback：改写路径为 / 交给 index.html
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/"
		fileServer.ServeHTTP(w, r2)
	}
}
