# C 端 ↔ 云库 · 对接接口契约 v1

> 本文档是**墨染酒馆 C 端**与**云端公共剧本库**之间的**固定接口契约**。
> C 端与云库独立开发、独立部署，只要各自遵循本契约即可对接。
> 云库后续补全功能，不影响已按本契约开发的 C 端。

**版本：v1** ｜ **接口前缀：`/api/scripts`**（无版本号路径）

---

## 1. 版本与变更规则

| 规则 | 说明 |
|---|---|
| 当前版本 | v1，路径 `/api/scripts` |
| 向后兼容变更 | 新增字段、新增可选参数，不破坏现有 C 端 |
| 破坏性变更 | 升级为 `/api/v2/...` 前缀，C 端按新版本适配 |

---

## 2. 基础约定

- **传输**：HTTP + JSON，UTF-8
- **身份**：所有请求必须带请求头 `X-UID: <10位数字字母>`（C 端自动生成并携带）
  - 缺失 / 非法 → **401** `{"error":"缺少有效的身份标识（X-UID）"}`
- **错误**：非 2xx 统一返回 `{"error":"中文提示"}`
- **跨域**：云库响应头必须含
  ```
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
  Access-Control-Allow-Headers: Content-Type, X-UID
  ```
  OPTIONS 预检返回 204。
- **时间戳**：Unix 毫秒

---

## 3. 接口定义（共 4 个）

### 3.1 上传剧本

```
POST /api/scripts
Headers: X-UID, Content-Type: application/json
Body:    .ink.json 文本（见 §4.1）
```

**成功 201**
```json
{ "id": "云端条目id（16位hex）" }
```

**错误**：400 格式不正确 / 401 无 UID / 429 限流

### 3.2 目录列表（含搜索）

```
GET /api/scripts?q=关键词
Headers: X-UID
```

**成功 200**：`PublicMeta[]`（按创建时间倒序），`q` 匹配标题/简介/标签（大小写不敏感，空则返回全部）

```json
[
  { "id": "…", "title": "标题", "description": "简介",
    "coverUrl": "…", "tags": ["标签"],
    "author": "上传者UID", "createdAt": 0, "downloadCount": 3 }
]
```

**错误**：401 无 UID / 429 限流

### 3.3 下载剧本

```
GET /api/scripts/{id}
Headers: X-UID
```

**成功 200**：`.ink.json` 原文（Content-Type: application/json），**云库下载计数 +1**

**错误**：401 无 UID / 404 不存在 / **429 下载配额超限**（今日额度用完）

### 3.4 删除剧本

```
DELETE /api/scripts/{id}
Headers: X-UID
```

**成功 200**
```json
{ "ok": true }
```

**错误**：401 无 UID / 403 非本人上传（他人 UID 无权删）/ 404 不存在 / 429 限流

---

## 4. 数据格式

### 4.1 `.ink.json`（统一交换格式）

```json
{
  "version": 1,
  "type": "ink-tavern-script",
  "exportedAt": 1724460000000,
  "data": { "…Script…" }
}
```

- C 端上传：把本地 `Script` 包装成此结构
- 云库按原文落盘 / 返回；C 端下载后按 `data` 解析还原
- `Script` 结构（C 端内部，见 `web/src/lib/types.ts` / 服务端 `store.models`）：
  ```json
  {
    "meta": { "id": "", "title": "标题", "description": "简介",
              "coverUrl": "", "tags": [], "createdAt": 0, "updatedAt": 0, "playCount": 0 },
    "prompt": "System Prompt 全文",
    "worldbook": [ { "name": "词条名", "type": "设定", "triggers": ["激活词"],
                     "content": "内容", "firstAppeared": 0, "lastAppeared": 0, "active": true } ],
    "guide": "引导页 HTML（可选）"
  }
  ```

### 4.2 `PublicMeta`（云库目录条目）

```json
{
  "id":           "string, 云端条目id",
  "title":        "string, 标题",
  "description":  "string, 简介",
  "coverUrl":     "string, 封面（可省略）",
  "tags":         "string[]",
  "author":       "string, 上传者UID",
  "createdAt":    "int64, Unix毫秒",
  "downloadCount": "int, 累计下载数"
}
```

---

## 5. 安全与限流约定

| 机制 | 默认值 | 触发 |
|---|---|---|
| UID 鉴权 | 10 位数字字母 | 缺失/非法 → 401 |
| 单 IP 限流 | 60 次/分钟/IP | 超限 → 429 |
| 每日下载配额 | 10 本/UID/天 | 超限 → 429「今日下载配额已用完」 |
| IP 兜底 | 30 本/IP/天 | 同 IP 所有 UID 共享，防换 UID 绕过 |
| 上传奖励 | 上传 1 个 +3 当日额度 | 激励共享 |
| 归属删除 | 仅上传者本人 | 他人 UID → 403 |

---

## 6. C 端实现参考（已按本契约开发）

| 功能 | 文件 |
|---|---|
| 云库请求封装（X-UID / 绝对地址） | `client/web/src/api/index.ts` → `listLibraryScripts` / `getLibraryScript` / `uploadLibraryScript` / `deleteLibraryScript` |
| UID 获取 | `GET /api/client/uid`（主服务生成） |
| 云库页面 | `client/web/src/views/LibraryView.vue` |
| 云库后端实现 | `cloud/main.go`（4 个 handler 与本节一一对应） |
