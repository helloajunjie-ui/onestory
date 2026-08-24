# 墨染酒馆 · 技术架构

本文面向开发与运维，说明系统组成、模块职责、数据模型、安全设计与部署方式。

---

## 1. 系统总览

墨染酒馆由**两套独立服务**组成，可分别或一起容器化部署：

```
┌─────────────────────────────────────────────┐
│  墨染酒馆主服务 (server/, :8080)             │
│  ┌──────────┐   REST /api + SSE    ┌──────┐ │
│  │ Vue3 前端 │◄───────────────────►│ Go   │ │
│  │ (web/)   │   AI 请求经后端代理   │ 后端 │ │
│  └──────────┘                      └──┬───┘ │
│                                       │ SQLite
│                                  server/data/ │
└─────────────────────────────────────────────┘
               │  HTTPS + X-UID 鉴权
               ▼
┌─────────────────────────────────────────────┐
│  云端公共剧本库 (cloud/, :8787)               │
│  纯 Go 标准库，JSON 文件存储                  │
│  cloud/data/library/{id}.json + index.json   │
└─────────────────────────────────────────────┘
```

- **主服务**：剧本 / 存档 / 设置 / 资源 / AI 代理 / 静态托管，单文件内嵌前端。
- **云端公共库**：共享剧本的上传 / 目录 / 下载 / 删除，格式统一 `.ink.json`，可独立部署到公网。

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Go 1.26（标准库 `net/http`，Go 1.22+ 方法路由 `"METHOD /path/{param}"`） |
| 数据库 | SQLite via `modernc.org/sqlite`（**纯 Go，无 CGO**，免交叉编译困扰） |
| 前端 | Vue 3 + Vite + TypeScript + Pinia + Vue Router + Tailwind CSS 4（无组件库） |
| 云端 | Go 标准库，JSON 文件存储（`crypto/rand` / `regexp` / `sync`） |
| 测试 | Playwright（e2e，自动起独立测试服务 :8099 + `data-e2e` 隔离） |
| 部署 | Docker 多阶段构建 → alpine 精简镜像，`docker compose` 编排 |

## 3. 目录结构

```
server/                    Go 后端主服务
  main.go                  入口（-port 默认 8080，-data 默认 ./data）
  internal/store/          SQLite：schema.sql / models.go / store.go（全部 CRUD）
  internal/ai/             AI 代理：OpenAI 兼容上游转发 + SSE 中继
  internal/api/            REST 端点：scripts/saves/settings/assets/backup/ai/share/static
  internal/webui/          go:embed 内嵌前端 dist + SPA fallback
  data/                    SQLite 库 inktavern.db（运行时生成，不入库）
web/                       Vue 3 前端
  src/api/                 fetch 封装 + SSE 流式 + 类型化 API
  src/stores/              Pinia：config（AI/外观/云端配置 + UID）、toast
  src/lib/                 prompt-builder / worldbook-scanner / memory-engine / script-import / markdown / guide
  src/composables/         useChatEngine（统一对话引擎）
  src/views/               首页 / 编辑器 / 游玩 / 对话 / 设置 / 公共剧本库 / 存储自测
cloud/                     云端公共剧本库（独立 Go 程序）
  main.go                  JSON 文件存储 + UID 鉴权 + 限流 + 下载配额
e2e/                       Playwright 冒烟测试（7 项）
```

## 4. 数据模型（SQLite）

约定：元数据用标量列（列表页排序 / 过滤），复杂结构存 JSON 列；应用总是整份读写。

```
scripts   id PK · title · description · cover_url · tags(JSON) · prompt ·
          worldbook(JSON) · guide · created_at · updated_at · play_count
saves     id PK · script_id FK→scripts ON DELETE CASCADE · name · turn_count ·
          summary · history(JSON) · state(JSON) · branches(JSON) ·
          dynamic_worldbook(JSON) · created_at · updated_at · idx_saves_script_id
settings  key PK · value(JSON)          # ai / appearance / cloud / client_uid
assets    path PK · data
shares    code PK · script_id · script(JSON 快照) · created_at   # 分享码（云端预留）
```

云端公共库（`cloud/`）不使用数据库，改为 JSON 文件：

```
cloud/data/library/{id}.json   # 每剧本一个 .ink.json 原文
cloud/data/index.json          # 目录索引 PublicMeta[]（标题/简介/封面/标签/作者/下载数/时间）
```

## 5. API 概览

### 主服务（`/api` 前缀）

| 域 | 端点 |
|---|---|
| 剧本 | `POST/GET /api/scripts`、`GET/PUT/DELETE /api/scripts/{id}` |
| 存档 | `POST/GET /api/saves`、`GET/PUT/DELETE /api/saves/{id}`、`GET /api/saves?scriptId=` |
| 设置 | `GET/PUT /api/settings/{ai,appearance,cloud}`、`GET /api/client/uid` |
| 资源 | `GET/PUT /api/assets`、`GET/PUT /api/bg-image` |
| 备份 | `GET /api/backup/export`、`POST /api/backup/import`（兼容 3 种旧格式） |
| AI | `POST /api/ai/chat/completions`（SSE 流式）、`GET /api/ai/models` |
| 分享 | `POST /api/share`、`GET /api/share/{code}`、`GET /api/share/{code}/download`（云端预留） |

错误统一 `{"error":"中文消息"}`；成功返回裸对象 / `{"id":...}` / `{"ok":true}`。

### 云端公共库（独立 :8787）

| 端点 | 说明 |
|---|---|
| `POST /api/scripts` | 上传 `.ink.json`（body），`author` = UID |
| `GET /api/scripts?q=` | 目录列表 + 关键词搜索（标题/简介/标签） |
| `GET /api/scripts/{id}` | 下载 `.ink.json` 原文（下载计数 +1） |
| `DELETE /api/scripts/{id}` | 删除（仅上传者本人） |

## 6. 安全设计

云端公共库对外暴露，防「外部拉全库」与批量抓取，三层防护：

1. **UID 身份鉴权**：所有 `/api/scripts` 请求须带 `X-UID`（10 位数字字母，`^[A-Za-z0-9]{10}$`），缺失返回 401。UID 由主服务首次 `GET /api/client/uid` 生成并持久化（settings `client_uid`），前端自动携带。上传以 UID 记录归属，**删除校验归属**（他人 UID → 403）。
2. **单 IP 限流**：滑动窗口，默认 60 次/分钟/IP（`-ratelimit`），支持 `X-Forwarded-For` 取真实 IP，超限 429。
3. **每日下载配额**：内存态，跨天惰性重置。每 UID 默认 10 本/天 + 每 IP 默认 30 本/天兜底（同 IP 共享，换 UID 无效）+ 上传 1 个奖励该 UID 当日 +3 额度。flag：`-daily-quota` / `-daily-ip-quota` / `-bonus-per-upload`。

> UID 属弱身份令牌，定位是防随机扫描与批量抓取；公网部署务必叠加 HTTPS 反代。

## 7. 剧本导入机制（`web/src/lib/script-import.ts`）

**规则映射优先，AI 分析兜底**：`detectFormat` 定位平台 → `parseByRules` 提取 → 关键字段缺失才走 AI。

- 支持格式：春潮 `work.*`、风月 `pre_prompt`+`world_book`、MISS `promptData.*`、日礼扁平、春水 `braindance.*`（含 `embeddedWorldBook`）、酒馆 SillyTavern（`spec|data|character`，V2/V3/Airi/Janitor）
- **原则**：提取是「正则 + 范围」的抓取规则，有什么提取什么，不生成、不补全，没有就保持空
- **世界书**：词条名 = 激活词第一个（对齐成熟转换工具）；激活词 `split(/_(?:or|and)_|@wb@/i)`，支持对象格式
- **提示词拼接顺序**：破甲词 → 前置 → 主提示词 → 后置 → 文风 → 输出规则，过滤占位符后 `join('\n\n')`

## 8. L2 动态记忆（`web/src/lib/memory-engine.ts`）

对话页每回合后台调 AI 提取剧情实体 → 同实体按 name 匹配、内容智能合并（增量拼接 / 完整版去重）→ 单条超 **1000 字自动 AI 总结压缩** → 上限 50 条、20 回合活跃淘汰 5 条。函数式合并 `dynamicWorldbook` 防 stale closure 覆盖新消息。

## 9. 前端要点

- **useChatEngine**（`composables/`）：4 场景（普通发送 / 引导页提交 / 重新生成 / 编辑重发）共用一套流程；流式失败自动降级非流式并同步切换模式。
- **对话页**（`ConversationView.vue`）：50 回合/页分页、页码折叠、消息编辑/删除/重新生成、世界书命中气泡、底部悬浮「到底部」按钮、外观 CSS 变量（字号/气泡透明度/文字色/顶栏透明度/背景压暗）。
- **Toast / ConfirmDialog**：全站替换原生 `alert/confirm`，保持暗色主题一致。

## 10. 部署

见 [DEPLOY.md](DEPLOY.md)。要点：

- 两套服务各自 `Dockerfile`（多阶段：node 构建前端 → golang 编译 → alpine 运行），`docker compose up -d --build` 一键起。
- 数据 bind mount：`./data/server`（主服务 SQLite）、`./data/cloud`（云端剧本库）。
- 主服务为单文件可执行（`go:embed` 内嵌前端），也可不依赖 Docker 直接运行。

## 11. 开发与测试

```bash
# 开发
cd server && go run .                 # :8080
cd web && npm run dev                 # :5173（/api 代理到 8080）

# 云端服务
cd cloud && go run . -port 8787       # :8787（需先配好 UID/配额参数）

# 校验
cd web && npx vue-tsc --noEmit && npm run build
cd server && go build -o ink-tavern.exe .
npx playwright test                   # e2e，自动起 :8099 + data-e2e 隔离
```
