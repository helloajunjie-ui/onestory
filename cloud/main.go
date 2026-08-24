// 墨染酒馆云端剧本库：一个存储 .ink.json 的轻量共享服务。
// 纯 Go 标准库，无第三方依赖，数据以 JSON 文件落盘，可独立部署到云端。
//
// 数据目录：
//   {data}/library/{id}.json   每剧本一个 .ink.json 原文件
//   {data}/index.json          目录索引（PublicMeta 数组）
//
// API：
//   POST   /api/scripts           上传（body 为 .ink.json 文本，?author= 可选）
//   GET    /api/scripts?q=关键词  目录列表（q 匹配标题/简介/标签，空 q 返回全部）
//   GET    /api/scripts/{id}      下载 .ink.json 原文（下载计数 +1）
//   DELETE /api/scripts/{id}      删除
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// PublicMeta 目录索引条目
type PublicMeta struct {
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	Description   string   `json:"description"`
	CoverURL      string   `json:"coverUrl,omitempty"`
	Tags          []string `json:"tags"`
	Author        string   `json:"author,omitempty"`
	CreatedAt     int64    `json:"createdAt"`
	DownloadCount int      `json:"downloadCount"`
}

// store JSON 文件存储
type store struct {
	mu    sync.Mutex
	dir   string
	index []PublicMeta
}

func newStore(dir string) (*store, error) {
	s := &store{dir: dir}
	if err := os.MkdirAll(filepath.Join(dir, "library"), 0o755); err != nil {
		return nil, err
	}
	if err := s.loadIndex(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *store) indexPath() string   { return filepath.Join(s.dir, "index.json") }
func (s *store) scriptPath(id string) string {
	return filepath.Join(s.dir, "library", id+".json")
}

func (s *store) loadIndex() error {
	data, err := os.ReadFile(s.indexPath())
	if err != nil {
		if os.IsNotExist(err) {
			s.index = []PublicMeta{}
			return nil
		}
		return err
	}
	if err := json.Unmarshal(data, &s.index); err != nil {
		// 索引损坏时重置为空，不阻断启动
		s.index = []PublicMeta{}
	}
	return nil
}

// saveIndexLocked 原子写索引（临时文件 + rename），需持有 s.mu
func (s *store) saveIndexLocked() error {
	data, err := json.MarshalIndent(s.index, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.indexPath() + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.indexPath())
}

func (s *store) findIndex(id string) int {
	for i, m := range s.index {
		if m.ID == id {
			return i
		}
	}
	return -1
}

func (s *store) exists(id string) bool {
	_, err := os.Stat(s.scriptPath(id))
	return err == nil
}

// ==================== Handlers ====================

func handleUpload(s *store, q *quota) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := requireUID(w, r)
		if !ok {
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 10<<20)) // 10MB 上限
		if err != nil {
			writeError(w, http.StatusBadRequest, "读取请求失败")
			return
		}
		var pack struct {
			Version int             `json:"version"`
			Type    string          `json:"type"`
			Data    json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(body, &pack); err != nil || pack.Type != "ink-tavern-script" {
			writeError(w, http.StatusBadRequest, "格式不正确：需要墨染酒馆 .ink.json（ink-tavern-script）格式")
			return
		}
		var script struct {
			Meta struct {
				Title       string   `json:"title"`
				Description string   `json:"description"`
				CoverURL    string   `json:"coverUrl"`
				Tags        []string `json:"tags"`
			} `json:"meta"`
		}
		if err := json.Unmarshal(pack.Data, &script); err != nil {
			writeError(w, http.StatusBadRequest, "剧本数据解析失败")
			return
		}

		id := newID()
		if err := os.WriteFile(s.scriptPath(id), body, 0o644); err != nil {
			writeError(w, http.StatusInternalServerError, "写入剧本文件失败")
			return
		}
		meta := PublicMeta{
			ID:          id,
			Title:       script.Meta.Title,
			Description: script.Meta.Description,
			CoverURL:    script.Meta.CoverURL,
			Tags:        script.Meta.Tags,
			Author:      uid, // 上传者身份 = UID，删除时校验归属
			CreatedAt:   time.Now().UnixMilli(),
		}
		if meta.Title == "" {
			meta.Title = "未命名剧本"
		}
		if meta.Tags == nil {
			meta.Tags = []string{}
		}

		s.mu.Lock()
		s.index = append(s.index, meta)
		if err := s.saveIndexLocked(); err != nil {
			s.mu.Unlock()
			os.Remove(s.scriptPath(id))
			writeError(w, http.StatusInternalServerError, "索引写入失败")
			return
		}
		s.mu.Unlock()

		// 上传成功 → 奖励该 UID 当日下载额度（激励共享）
		q.addUploadBonus(uid)

		writeJSON(w, http.StatusCreated, map[string]string{"id": id})
	}
}

func handleList(s *store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := requireUID(w, r); !ok {
			return
		}
		q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
		s.mu.Lock()
		items := make([]PublicMeta, len(s.index))
		copy(items, s.index)
		s.mu.Unlock()
		sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt > items[j].CreatedAt })
		if q != "" {
			filtered := make([]PublicMeta, 0, len(items))
			for _, m := range items {
				if strings.Contains(strings.ToLower(m.Title), q) ||
					strings.Contains(strings.ToLower(m.Description), q) ||
					tagsMatch(m.Tags, q) {
					filtered = append(filtered, m)
				}
			}
			items = filtered
		}
		writeJSON(w, http.StatusOK, items)
	}
}

func handleDownload(s *store, q *quota) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := requireUID(w, r)
		if !ok {
			return
		}
		// 每日下载配额（UID + IP 双维度）
		if !q.tryDownload(uid, clientIP(r)) {
			writeError(w, http.StatusTooManyRequests,
				fmt.Sprintf("今日下载配额已用完（每用户每日 %d 本），上传分享可获得额外额度", q.dailyUID))
			return
		}
		id := r.PathValue("id")
		if !s.exists(id) {
			writeError(w, http.StatusNotFound, "剧本不存在")
			return
		}
		body, err := os.ReadFile(s.scriptPath(id))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取剧本失败")
			return
		}
		// 下载计数 +1（尽力而为，不影响响应）
		s.mu.Lock()
		if i := s.findIndex(id); i >= 0 {
			s.index[i].DownloadCount++
			_ = s.saveIndexLocked()
		}
		s.mu.Unlock()

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write(body)
	}
}

func handleDelete(s *store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := requireUID(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		if !s.exists(id) {
			writeError(w, http.StatusNotFound, "剧本不存在")
			return
		}
		// 归属校验：仅上传者（同 UID）可删除，防止他人删库
		s.mu.Lock()
		idx := s.findIndex(id)
		if idx < 0 {
			s.mu.Unlock()
			writeError(w, http.StatusNotFound, "剧本不存在")
			return
		}
		if s.index[idx].Author != uid {
			s.mu.Unlock()
			writeError(w, http.StatusForbidden, "无权删除他人上传的剧本")
			return
		}
		s.index = append(s.index[:idx], s.index[idx+1:]...)
		_ = s.saveIndexLocked()
		s.mu.Unlock()
		_ = os.Remove(s.scriptPath(id))
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// ==================== 工具函数 ====================

// ==================== 鉴权 / 限流 ====================

// uidRe 10 位数字字母（C 端内部身份标识）
var uidRe = regexp.MustCompile(`^[A-Za-z0-9]{10}$`)

// uidOf 从请求取 UID：优先 X-UID header，回退 ?uid= query
func uidOf(r *http.Request) string {
	if h := strings.TrimSpace(r.Header.Get("X-UID")); h != "" {
		return h
	}
	return strings.TrimSpace(r.URL.Query().Get("uid"))
}

// requireUID 校验 UID 合法性，非法返回 401
func requireUID(w http.ResponseWriter, r *http.Request) (string, bool) {
	uid := uidOf(r)
	if !uidRe.MatchString(uid) {
		writeError(w, http.StatusUnauthorized, "缺少有效的身份标识（X-UID）")
		return "", false
	}
	return uid, true
}

// rateLimiter 单 IP 滑动窗口频率限制
type rateLimiter struct {
	mu      sync.Mutex
	hits    map[string][]int64 // ip -> 请求时间戳(ms)
	limit   int
	window  time.Duration
}

func newRateLimiter(limitPerMinute int) *rateLimiter {
	return &rateLimiter{
		hits:   make(map[string][]int64),
		limit:  limitPerMinute,
		window: time.Minute,
	}
}

// allow 返回该 IP 是否允许本次请求
func (rl *rateLimiter) allow(ip string) bool {
	now := time.Now().UnixMilli()
	cutoff := now - rl.window.Milliseconds()
	rl.mu.Lock()
	defer rl.mu.Unlock()
	lst := rl.hits[ip]
	filtered := lst[:0]
	for _, t := range lst {
		if t >= cutoff {
			filtered = append(filtered, t)
		}
	}
	if len(filtered) >= rl.limit {
		rl.hits[ip] = filtered
		return false
	}
	rl.hits[ip] = append(filtered, now)
	return true
}

// clientIP 取客户端 IP（考虑反代 X-Forwarded-For）
func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		if i := strings.IndexByte(fwd, ','); i >= 0 {
			return strings.TrimSpace(fwd[:i])
		}
		return strings.TrimSpace(fwd)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// ==================== 每日下载配额 ====================

// quota 每日下载配额：UID 维度限制单用户，IP 维度兜底（防换 UID 绕过），上传可奖励额外额度
type quota struct {
	mu             sync.Mutex
	day            string
	uidDownloads   map[string]int
	ipDownloads    map[string]int
	uidBonus       map[string]int
	dailyUID       int
	dailyIP        int
	bonusPerUpload int
}

func newQuota(dailyUID, dailyIP, bonusPerUpload int) *quota {
	return &quota{
		day:            today(),
		uidDownloads:   map[string]int{},
		ipDownloads:    map[string]int{},
		uidBonus:       map[string]int{},
		dailyUID:       dailyUID,
		dailyIP:        dailyIP,
		bonusPerUpload: bonusPerUpload,
	}
}

func today() string {
	return time.Now().Format("2006-01-02")
}

// rollover 跨天时清空计数（惰性），需持有 q.mu
func (q *quota) rollover() {
	if t := today(); t != q.day {
		q.day = t
		q.uidDownloads = map[string]int{}
		q.ipDownloads = map[string]int{}
		q.uidBonus = map[string]int{}
	}
}

// addUploadBonus 上传成功后为该 UID 增加当日下载额度（激励分享）
func (q *quota) addUploadBonus(uid string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.rollover()
	q.uidBonus[uid] += q.bonusPerUpload
}

// tryDownload 尝试消耗一次下载额度，成功返回 true（内部同时推进 UID 与 IP 两个计数）
func (q *quota) tryDownload(uid, ip string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.rollover()
	if q.ipDownloads[ip] >= q.dailyIP {
		return false
	}
	if q.uidDownloads[uid] >= q.dailyUID+q.uidBonus[uid] {
		return false
	}
	q.uidDownloads[uid]++
	q.ipDownloads[ip]++
	return true
}

// withAuth 中间件：限流 + UID 校验（除 OPTIONS 外所有 /api 请求）
func withAuth(rl *rateLimiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		// 单 IP 限流
		if !rl.allow(clientIP(r)) {
			writeError(w, http.StatusTooManyRequests, "请求过于频繁，请稍后再试")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func tagsMatch(tags []string, q string) bool {
	for _, t := range tags {
		if strings.Contains(strings.ToLower(t), q) {
			return true
		}
	}
	return false
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// withCORS 允许任意来源跨域（C 端浏览器直接访问云端）
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	port := flag.Int("port", 8787, "监听端口")
	data := flag.String("data", "./data", "数据目录（存 library/{id}.json 与 index.json）")
	ratePerMinute := flag.Int("ratelimit", 60, "单 IP 每分钟最大请求数")
	dailyUID := flag.Int("daily-quota", 10, "每 UID 每日最大下载数")
	dailyIP := flag.Int("daily-ip-quota", 30, "每 IP 每日最大下载数（兜底防换 UID）")
	bonusPerUpload := flag.Int("bonus-per-upload", 3, "每上传 1 个剧本奖励的当日下载额度")
	flag.Parse()

	st, err := newStore(*data)
	if err != nil {
		fmt.Fprintln(os.Stderr, "初始化存储失败:", err)
		os.Exit(1)
	}

	rl := newRateLimiter(*ratePerMinute)
	q := newQuota(*dailyUID, *dailyIP, *bonusPerUpload)

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/scripts", handleUpload(st, q))
	mux.HandleFunc("GET /api/scripts", handleList(st))
	mux.HandleFunc("GET /api/scripts/{id}", handleDownload(st, q))
	mux.HandleFunc("DELETE /api/scripts/{id}", handleDelete(st))

	// 中间件链：CORS → 限流 + UID 鉴权
	handler := withAuth(rl, mux)

	addr := fmt.Sprintf(":%d", *port)
	fmt.Printf("墨染酒馆云端剧本库已启动: http://localhost:%d（限流 %d 次/分钟/IP；下载配额 %d 本/UID/天 + %d 本/IP/天兜底，上传 +%d 本）\n",
		*port, *ratePerMinute, *dailyUID, *dailyIP, *bonusPerUpload)
	if err := http.ListenAndServe(addr, withCORS(handler)); err != nil {
		fmt.Fprintln(os.Stderr, "启动失败:", err)
		os.Exit(1)
	}
}
