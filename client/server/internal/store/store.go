package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// ErrNotFound 记录不存在
var ErrNotFound = errors.New("record not found")

// Store SQLite 存储层
type Store struct {
	db *sql.DB
}

// Open 打开（或创建）数据目录下的 SQLite 数据库并建表。
// modernc.org/sqlite 纯 Go 实现，无需 CGO。
func Open(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	dbPath := filepath.Join(dataDir, "inktavern.db")
	// _pragma 启用 WAL（并发读写）与 foreign_keys（级联删除）
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)", filepath.ToSlash(dbPath))
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// 注意：不要 SetMaxOpenConns(1) —— 单连接池下若在遍历 rows 的同时执行新查询（如
	// ListAllSaves 内再调 GetSave）会死锁。WAL + busy_timeout 已保证并发读写安全。

	if _, err := db.Exec(schemaSQL); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

// Close 关闭数据库
func (s *Store) Close() error { return s.db.Close() }

// ==================== 辅助函数 ====================

// newUUID 生成 UUID v4（与前端 crypto.randomUUID() 格式一致）
func newUUID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// nullOrEmpty 空字符串转为 NULL（guide 等可选字段）
func nullOrEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// mustJSON 序列化为 JSON 字符串，失败返回空
func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// scanScriptRow 从一行扫描结果组装 Script（供 GetScript 使用）
type scriptRow struct {
	Title, Description, CoverURL, Tags, Prompt, Worldbook string
	Guide                                                *string
	CreatedAt, UpdatedAt                                 int64
	PlayCount                                            int
}

func (r scriptRow) toScript(id string) Script {
	var tags []string
	_ = json.Unmarshal([]byte(r.Tags), &tags)
	var wb []WorldbookEntry
	_ = json.Unmarshal([]byte(r.Worldbook), &wb)
	guide := ""
	if r.Guide != nil {
		guide = *r.Guide
	}
	return Script{
		Meta: ScriptMeta{
			ID: id, Title: r.Title, Description: r.Description, CoverURL: r.CoverURL,
			Tags: tags, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, PlayCount: r.PlayCount,
		},
		Prompt:    r.Prompt,
		Worldbook: wb,
		Guide:     guide,
	}
}

// ==================== 剧本 CRUD ====================

// CreateScript 创建剧本，返回 id（服务端生成，若传入空）
func (s *Store) CreateScript(script Script) (string, error) {
	if script.Meta.ID == "" {
		script.Meta.ID = newUUID()
	}
	now := time.Now().UnixMilli()
	if script.Meta.CreatedAt == 0 {
		script.Meta.CreatedAt = now
	}
	script.Meta.UpdatedAt = now
	script.Meta.PlayCount = 0

	_, err := s.db.Exec(`
		INSERT INTO scripts (id, title, description, cover_url, tags, prompt, worldbook, guide, created_at, updated_at, play_count)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		script.Meta.ID, script.Meta.Title, script.Meta.Description, script.Meta.CoverURL,
		mustJSON(script.Meta.Tags), script.Prompt, mustJSON(script.Worldbook), nullOrEmpty(script.Guide),
		script.Meta.CreatedAt, script.Meta.UpdatedAt, script.Meta.PlayCount,
	)
	if err != nil {
		return "", err
	}
	return script.Meta.ID, nil
}

// GetScript 读取剧本
func (s *Store) GetScript(id string) (Script, error) {
	var row scriptRow
	err := s.db.QueryRow(`
		SELECT title, description, cover_url, tags, prompt, worldbook, guide, created_at, updated_at, play_count
		FROM scripts WHERE id = ?`, id).
		Scan(&row.Title, &row.Description, &row.CoverURL, &row.Tags, &row.Prompt, &row.Worldbook,
			&row.Guide, &row.CreatedAt, &row.UpdatedAt, &row.PlayCount)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Script{}, ErrNotFound
		}
		return Script{}, err
	}
	return row.toScript(id), nil
}

// ListScripts 列出全部剧本元数据（updatedAt 降序）
func (s *Store) ListScripts() ([]ScriptMeta, error) {
	rows, err := s.db.Query(`
		SELECT id, title, description, cover_url, tags, created_at, updated_at, play_count
		FROM scripts ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []ScriptMeta{}
	for rows.Next() {
		var m ScriptMeta
		var tags string
		if err := rows.Scan(&m.ID, &m.Title, &m.Description, &m.CoverURL, &tags, &m.CreatedAt, &m.UpdatedAt, &m.PlayCount); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(tags), &m.Tags)
		list = append(list, m)
	}
	return list, rows.Err()
}

// UpdateScript 部分更新剧本（读-合并-写，保留未传字段）。
// patch 为前端 JSON body 解析出的 map，键对应 Script 顶层字段及 meta 子字段。
func (s *Store) UpdateScript(id string, patch map[string]json.RawMessage) error {
	cur, err := s.GetScript(id)
	if err != nil {
		return err
	}

	// meta 子字段合并
	if rawMeta, ok := patch["meta"]; ok {
		var pm map[string]json.RawMessage
		if err := json.Unmarshal(rawMeta, &pm); err == nil {
			if raw, ok := pm["title"]; ok {
				_ = json.Unmarshal(raw, &cur.Meta.Title)
			}
			if raw, ok := pm["description"]; ok {
				_ = json.Unmarshal(raw, &cur.Meta.Description)
			}
			if raw, ok := pm["coverUrl"]; ok {
				_ = json.Unmarshal(raw, &cur.Meta.CoverURL)
			}
			if raw, ok := pm["tags"]; ok {
				_ = json.Unmarshal(raw, &cur.Meta.Tags)
			}
			if raw, ok := pm["playCount"]; ok {
				_ = json.Unmarshal(raw, &cur.Meta.PlayCount)
			}
		}
	}
	if raw, ok := patch["prompt"]; ok {
		_ = json.Unmarshal(raw, &cur.Prompt)
	}
	if raw, ok := patch["worldbook"]; ok {
		_ = json.Unmarshal(raw, &cur.Worldbook)
	}
	if raw, ok := patch["guide"]; ok {
		var g string
		_ = json.Unmarshal(raw, &g)
		cur.Guide = g
	}
	cur.Meta.UpdatedAt = time.Now().UnixMilli()

	_, err = s.db.Exec(`
		UPDATE scripts SET title=?, description=?, cover_url=?, tags=?, prompt=?, worldbook=?, guide=?, updated_at=?
		WHERE id=?`,
		cur.Meta.Title, cur.Meta.Description, cur.Meta.CoverURL, mustJSON(cur.Meta.Tags),
		cur.Prompt, mustJSON(cur.Worldbook), nullOrEmpty(cur.Guide), cur.Meta.UpdatedAt, id)
	return err
}

// DeleteScript 删除剧本（级联删除其下所有存档，由 FK ON DELETE CASCADE 保证）
func (s *Store) DeleteScript(id string) error {
	res, err := s.db.Exec(`DELETE FROM scripts WHERE id=?`, id)
	if err != nil {
		return err
	}
	return ensureAffected(res)
}

// ==================== 存档 CRUD ====================

// CreateSave 创建存档，返回 saveId
func (s *Store) CreateSave(scriptID, name string) (string, error) {
	saveID := newUUID()
	now := time.Now().UnixMilli()
	if name == "" {
		name = "存档 " + time.Now().Format("2006-01-02 15:04")
	}
	_, err := s.db.Exec(`
		INSERT INTO saves (id, script_id, name, turn_count, summary, history, state, branches, dynamic_worldbook, created_at, updated_at)
		VALUES (?, ?, ?, 0, '', '[]', '{}', '[]', '[]', ?, ?)`,
		saveID, scriptID, name, now, now)
	if err != nil {
		return "", err
	}
	return saveID, nil
}

// GetSave 读取存档
func (s *Store) GetSave(id string) (SaveData, error) {
	var m SaveMeta
	var history, state, branches, dwb string
	err := s.db.QueryRow(`
		SELECT id, script_id, name, created_at, updated_at, turn_count, summary, history, state, branches, dynamic_worldbook
		FROM saves WHERE id = ?`, id).
		Scan(&m.ID, &m.ScriptID, &m.Name, &m.CreatedAt, &m.UpdatedAt, &m.TurnCount, &m.Summary,
			&history, &state, &branches, &dwb)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return SaveData{}, ErrNotFound
		}
		return SaveData{}, err
	}
	data := SaveData{Meta: m, State: map[string]any{}}
	_ = json.Unmarshal([]byte(history), &data.History)
	_ = json.Unmarshal([]byte(state), &data.State)
	_ = json.Unmarshal([]byte(branches), &data.Branches)
	_ = json.Unmarshal([]byte(dwb), &data.DynamicWorldbook)
	return data, nil
}

// ListSaves 列出某剧本下所有存档元数据（updatedAt 降序）
func (s *Store) ListSaves(scriptID string) ([]SaveMeta, error) {
	rows, err := s.db.Query(`
		SELECT id, script_id, name, created_at, updated_at, turn_count, summary
		FROM saves WHERE script_id=? ORDER BY updated_at DESC`, scriptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []SaveMeta{}
	for rows.Next() {
		var m SaveMeta
		if err := rows.Scan(&m.ID, &m.ScriptID, &m.Name, &m.CreatedAt, &m.UpdatedAt, &m.TurnCount, &m.Summary); err != nil {
			return nil, err
		}
		list = append(list, m)
	}
	return list, rows.Err()
}

// UpdateSave 部分更新存档（读-合并-写，保留未传字段）
func (s *Store) UpdateSave(id string, patch map[string]json.RawMessage) error {
	cur, err := s.GetSave(id)
	if err != nil {
		return err
	}

	if rawMeta, ok := patch["meta"]; ok {
		var pm map[string]json.RawMessage
		if err := json.Unmarshal(rawMeta, &pm); err == nil {
			if raw, ok := pm["name"]; ok {
				_ = json.Unmarshal(raw, &cur.Meta.Name)
			}
			if raw, ok := pm["summary"]; ok {
				_ = json.Unmarshal(raw, &cur.Meta.Summary)
			}
			if raw, ok := pm["turnCount"]; ok {
				_ = json.Unmarshal(raw, &cur.Meta.TurnCount)
			}
		}
	}
	if raw, ok := patch["history"]; ok {
		_ = json.Unmarshal(raw, &cur.History)
	}
	if raw, ok := patch["state"]; ok {
		_ = json.Unmarshal(raw, &cur.State)
	}
	if raw, ok := patch["branches"]; ok {
		_ = json.Unmarshal(raw, &cur.Branches)
	}
	if raw, ok := patch["dynamicWorldbook"]; ok {
		_ = json.Unmarshal(raw, &cur.DynamicWorldbook)
	}
	cur.Meta.UpdatedAt = time.Now().UnixMilli()

	_, err = s.db.Exec(`
		UPDATE saves SET name=?, turn_count=?, summary=?, history=?, state=?, branches=?, dynamic_worldbook=?, updated_at=?
		WHERE id=?`,
		cur.Meta.Name, cur.Meta.TurnCount, cur.Meta.Summary,
		mustJSON(cur.History), mustJSON(cur.State), mustJSON(cur.Branches), mustJSON(cur.DynamicWorldbook),
		cur.Meta.UpdatedAt, id)
	return err
}

// DeleteSave 删除存档
func (s *Store) DeleteSave(id string) error {
	res, err := s.db.Exec(`DELETE FROM saves WHERE id=?`, id)
	if err != nil {
		return err
	}
	return ensureAffected(res)
}

// ==================== 配置（settings） ====================

// GetSettingJSON 读取配置 JSON 字符串；不存在返回 ("", false, nil)
func (s *Store) GetSettingJSON(key string) (string, bool, error) {
	var val string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key=?`, key).Scan(&val)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return val, true, nil
}

// SetSettingJSON 写入配置 JSON 字符串（upsert）
func (s *Store) SetSettingJSON(key, value string) error {
	_, err := s.db.Exec(`
		INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}

// ==================== 资源（assets） ====================

// LoadAsset 读取资源；不存在返回 ("", false, nil)
func (s *Store) LoadAsset(path string) (string, bool, error) {
	var data string
	err := s.db.QueryRow(`SELECT data FROM assets WHERE path=?`, path).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return data, true, nil
}

// SaveAsset 写入资源（upsert）
func (s *Store) SaveAsset(path, data string) error {
	_, err := s.db.Exec(`
		INSERT INTO assets (path, data) VALUES (?, ?)
		ON CONFLICT(path) DO UPDATE SET data=excluded.data`, path, data)
	return err
}

// ==================== 分享（云端预留） ====================

// CreateShare 写入剧本分享快照
func (s *Store) CreateShare(code, scriptID, scriptJSON string, createdAt int64) error {
	_, err := s.db.Exec(`
		INSERT INTO shares (code, script_id, script, created_at) VALUES (?, ?, ?, ?)`,
		code, scriptID, scriptJSON, createdAt)
	return err
}

// GetShare 读取分享快照
func (s *Store) GetShare(code string) (Share, error) {
	var sh Share
	err := s.db.QueryRow(`SELECT code, script_id, script, created_at FROM shares WHERE code=?`, code).
		Scan(&sh.Code, &sh.ScriptID, &sh.Script, &sh.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Share{}, ErrNotFound
	}
	if err != nil {
		return Share{}, err
	}
	return sh, nil
}

// ListAllSaves 列出全部存档完整数据（备份导出用）
func (s *Store) ListAllSaves() ([]SaveData, error) {
	rows, err := s.db.Query(`SELECT id FROM saves`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []SaveData{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		data, err := s.GetSave(id)
		if err != nil {
			return nil, err
		}
		list = append(list, data)
	}
	return list, rows.Err()
}

// UpsertScript 按 id 覆盖写入剧本（备份导入用，保留传入的 created/updated/playCount）
func (s *Store) UpsertScript(script Script) error {
	if script.Meta.ID == "" {
		return errors.New("script id 为空")
	}
	_, err := s.db.Exec(`
		INSERT OR REPLACE INTO scripts (id, title, description, cover_url, tags, prompt, worldbook, guide, created_at, updated_at, play_count)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		script.Meta.ID, script.Meta.Title, script.Meta.Description, script.Meta.CoverURL,
		mustJSON(script.Meta.Tags), script.Prompt, mustJSON(script.Worldbook), nullOrEmpty(script.Guide),
		script.Meta.CreatedAt, script.Meta.UpdatedAt, script.Meta.PlayCount)
	return err
}

// UpsertSave 按 id 覆盖写入存档（备份导入用）
func (s *Store) UpsertSave(data SaveData) error {
	if data.Meta.ID == "" {
		return errors.New("save id 为空")
	}
	_, err := s.db.Exec(`
		INSERT OR REPLACE INTO saves (id, script_id, name, turn_count, summary, history, state, branches, dynamic_worldbook, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		data.Meta.ID, data.Meta.ScriptID, data.Meta.Name, data.Meta.TurnCount, data.Meta.Summary,
		mustJSON(data.History), mustJSON(data.State), mustJSON(data.Branches), mustJSON(data.DynamicWorldbook),
		data.Meta.CreatedAt, data.Meta.UpdatedAt)
	return err
}

// ensureAffected 校验 DELETE 是否命中了记录
func ensureAffected(res sql.Result) error {
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
