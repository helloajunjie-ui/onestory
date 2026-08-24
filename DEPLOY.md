# 墨染酒馆 · 容器部署

两套系统**各自独立编排、独立部署**，互不依赖：

| 服务 | 编排文件 | 镜像来源 | 宿主机端口 | 数据卷 |
|---|---|---|---|---|
| **ink-tavern**（C 端主服务） | `client/docker-compose.yml` | `client/Dockerfile` | **23456**（容器内 8080） | `client/data` |
| **cloud**（云端公共剧本库） | `cloud/docker-compose.yml` | `cloud/Dockerfile` | **23457**（容器内 8787） | `cloud/data` |

> 使用冷门端口避免与常见服务（8080 等）冲突；若仍被占用，改各模块 `docker-compose.yml` 的 `ports` 左侧宿主机端口即可（右侧容器内端口固定）。

## 一、C 端独立部署（墨染酒馆）

```bash
cd client
docker compose up -d --build
# 访问 http://localhost:23456
```

- 常用：`docker compose ps` / `docker compose logs -f ink-tavern` / `docker compose down`
- 数据 bind mount 到 `client/data`（SQLite 库），`down` 不丢

## 二、云库独立部署（云端公共剧本库）

```bash
cd cloud
docker compose up -d --build
# 访问 http://localhost:23457
```

- 常用：`docker compose ps` / `docker compose logs -f cloud` / `docker compose down`
- 数据 bind mount 到 `cloud/data`（剧本库 JSON 文件）
- 安全内置：所有 `/api/scripts` 需 `X-UID`；单 IP 限流、每日下载配额

## 三、访问与配置

- 墨染酒馆：<http://localhost:23456>
- 云端公共库：<http://localhost:23457>
- 打开 **设置 → 公共剧本库**，云端服务地址填 `http://localhost:23457`，保存后即可浏览/上传/下载/导入共享剧本。
- 云端部署时用服务器 IP/域名替换 `localhost`，如 `http://服务器IP:23457`。

> 若在公网部署，建议给两个服务套 HTTPS 反代（Nginx/Caddy），并把云端地址改为线上域名。

## 四、数据持久化与迁移

```
client/data/   # 墨染酒馆 SQLite 库（inktavern.db）
cloud/data/    # 云端公共库（library/*.ink.json + index.json）
```

### 迁移已有数据（可选）
本地开发数据在 `client/server/data/` 与 `cloud/data/`。首次容器部署前复制：

```bash
# C 端：把本地开发库复制进容器卷目录
cp -r client/server/data/. client/data/
# 云库：复制本地公共库
cp -r cloud/data/. cloud/data/

# 然后各自 docker compose up -d --build
```

## 五、常见问题

- **端口被占用**：改各模块 `docker-compose.yml` 里的 `ports` 左侧宿主机端口（如 `"34560:8080"`），云端地址同步改。
- **拉取 golang:1.26-alpine 失败**：确认 Docker Hub 已发布该 tag；否则把两个 Dockerfile 的 `golang:1.26-alpine` 改为已有版本（如 `golang:1.25-alpine`，一般也能编 1.26 语法）。
- **云端 401**：公共库要求 `X-UID` 请求头，墨染酒馆客户端会自动携带；用 curl 直连需加 `-H "X-UID: <10位字母数字>"`。
- **下载 429**：每日下载配额（默认每用户 10 本/天，上传 +3），超限属预期。
