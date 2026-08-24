# 墨染酒馆 (Ink Tavern)

轻量级 AI 角色扮演（RP）文字冒险工具。创建或导入剧本，与 AI 扮演的角色展开沉浸式冒险，还能把作品上传到公共剧本库与人分享。

> 技术架构：**Go 后端 + Vue 3 前端 + SQLite**，单文件可执行、可 Docker 容器化、可部署云端。技术细节见 [ARCHITECTURE.md](ARCHITECTURE.md)。

---

## ✨ 功能亮点

| 模块 | 说明 |
|---|---|
| 📚 **剧本库** | 扑克牌式卡片管理，创建 / 编辑 / 游玩 / 分享 / 删除 |
| ✍️ **剧本编辑器** | 主提示词、世界书（关键词触发）、引导页（HTML 角色创建页 + 实时预览） |
| 🎭 **对话游玩** | 流式打字机回复、**动态记忆 L2**（自动提取剧情实体保持连贯）、历史分页、消息编辑/删除/重新生成、世界书抽屉、自定义外观 |
| 🌐 **公共剧本库** | 独立的**云端共享库**：上传剧本、浏览/搜索、一键下载导入本地，格式统一 `.ink.json` |
| 🤖 **AI 配置** | OpenAI 兼容协议（DeepSeek / Ollama / OpenRouter 等），BaseURL / API Key / 模型 / 破甲词 |
| 💾 **数据管理** | 全量备份导出 / 导入（`.itb`），兼容旧版本与分享格式 |

## 🚀 快速开始

### 方式零：本地独立部署（推荐日常使用，不依赖 Docker / 云端）

```bash
./start-local.sh              # 一键：构建并启动主服务 + 本地公共库
./start-local.sh --main-only  # 仅启动主服务（不跑公共库）
```

- 墨染酒馆 → http://localhost:8080
- 本地公共库 → http://localhost:8787（脚本已自动写入设置页云端地址，公共库本地可用）

本地与云端完全独立：本地不依赖 Docker、不依赖云端修复进度。云端部署是另一套（见 DEPLOY.md），两者互不影响。

### 方式一：Docker（云端/服务器部署，两套系统一键起）

```bash
docker compose up -d --build

# 墨染酒馆    → http://localhost:23456
# 云端公共库 → http://localhost:23457
```

进入 **设置 → 公共剧本库**，云端地址填 `http://localhost:23457`，即可使用共享剧本库。数据持久化在 `./data/`，详见 [DEPLOY.md](DEPLOY.md)。端口在 `docker-compose.yml` 里可改。

### 方式二：本地运行

```bash
# 后端（端口 8080）
cd server && go run .

# 前端开发（端口 5173，/api 代理到 8080）—— 生产则直接访问 8080
cd web && npm install && npm run dev
```

生产单文件构建：

```bash
cd web && npm run build          # 构建前端到 server/internal/webui/dist
cd ../server && go build -o ink-tavern.exe .
./ink-tavern.exe                 # 浏览器打开 http://localhost:8080
```

### ⚙️ 首次配置

打开「设置」，填写 API BaseURL（如 `https://api.deepseek.com`、`https://api.openai.com/v1`）、API Key 和模型。Key 存服务端，AI 请求由后端代理转发，前端不直接暴露。

## 🌐 公共剧本库

公共剧本库是一个**独立的云端服务**（`cloud/`，默认端口 8787）：

- **上传**：把「我的剧本」一键发布，或上传 `.ink.json` / 任意平台格式 JSON（自动转换）
- **浏览 / 搜索**：按标题 / 简介 / 标签检索，卡片展示封面、作者、下载数
- **导入本地**：选中后一键创建为本地剧本，直接进编辑器
- **安全**：每个客户端自动分配 UID 身份；上传者才能删除；每日下载配额（默认每用户 10 本/天，上传分享可获额外额度）防止批量抓取

> 部署到公网时建议为两个服务配置 HTTPS 反代，并把云端地址改为线上域名。

## 🧩 支持导入的剧本格式

规则映射优先、AI 分析兜底，自动提取标题 / 简介 / 标签 / 封面 / 提示词 / 世界书 / 引导页：

- **春潮**（`work.*`）、**风月**（`pre_prompt` + `world_book`）
- **MISS**（`promptData.*`）、**日礼**（扁平）
- **春水**（`braindance.*`）、**酒馆 SillyTavern**（V2/V3/Airi/Janitor）
- 任意其他 JSON 格式 → AI 分析提取（需已配置 AI）

## 📁 目录结构

```
server/      Go 后端（单文件可执行，内嵌前端）
web/         Vue 3 前端
cloud/       云端公共剧本库（独立 Go 服务）
e2e/         Playwright 冒烟测试
```

## 📖 更多文档

- [ARCHITECTURE.md](ARCHITECTURE.md) — 技术架构（面向开发/运维）
- [DEPLOY.md](DEPLOY.md) — Docker 容器部署与数据迁移

## 许可

MIT
