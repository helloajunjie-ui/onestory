package store

// schemaSQL 建表语句。
// 设计：元数据提为标量列（列表页排序/过滤），复杂结构（worldbook/history/state/branches）
// 存 JSON 列。应用总是整份读写 Script/SaveData，无细粒度查询，JSON 列最贴合轻量化目标。
const schemaSQL = `
CREATE TABLE IF NOT EXISTS scripts (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  cover_url   TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '[]',
  prompt      TEXT NOT NULL DEFAULT '',
  worldbook   TEXT NOT NULL DEFAULT '[]',
  guide       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  play_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS saves (
  id                TEXT PRIMARY KEY,
  script_id         TEXT NOT NULL,
  name              TEXT NOT NULL DEFAULT '',
  turn_count        INTEGER NOT NULL DEFAULT 0,
  summary           TEXT NOT NULL DEFAULT '',
  history           TEXT NOT NULL DEFAULT '[]',
  state             TEXT NOT NULL DEFAULT '{}',
  branches          TEXT NOT NULL DEFAULT '[]',
  dynamic_worldbook TEXT NOT NULL DEFAULT '[]',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_saves_script_id ON saves(script_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  path TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

-- 云端预留：剧本分享快照
CREATE TABLE IF NOT EXISTS shares (
  code       TEXT PRIMARY KEY,
  script_id  TEXT,
  script     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`
