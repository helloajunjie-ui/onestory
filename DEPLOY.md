# 墨染酒馆 · 容器部署

用 Docker Compose 一键部署两套系统：

| 服务 | 镜像来源 | 宿主机端口 | 数据卷 |
|---|---|---|---|
| **ink-tavern**（C 端主服务：剧本/存档/对话/设置） | `client/Dockerfile`（多阶段，内嵌前端） | **23456**（容器内 8080） | `./data/server` |
| **cloud**（云端公共剧本库） | `cloud/Dockerfile`（纯 Go 标准库） | **23457**（容器内 8787） | `./data/cloud` |

> 使用冷门端口避免与常见服务（8080 等）冲突；若仍被占用，改 `docker-compose.yml` 的 `ports` 左侧宿主机端口即可（右侧容器内端口固定）。

## 一、构建并启动

```bash
docker compose up -d --build
```

- 首次构建会拉取 node / golang / alpine 镜像并编译，耗时几分钟。
- 常用命令：`docker compose ps` / `docker compose logs -f ink-tavern` / `docker compose logs -f cloud` / `docker compose down`（停止，数据卷保留）。

## 二、访问与配置

- 墨染酒馆：<http://localhost:23456>
- 云端公共库：<http://localhost:23457>
- 打开 **设置 → 公共剧本库**，云端服务地址填 `http://localhost:23457`，保存后即可浏览/上传/下载/导入共享剧本。
- 云端部署时用服务器 IP/域名替换 `localhost`，如 `http://服务器IP:23457`。

> 若在公网部署，建议给两个服务套 HTTPS 反代（Nginx/Caddy），并把云端地址改为线上域名。

## 三、数据持久化与迁移

数据通过 bind mount 落在宿主机，`docker compose down` 不会丢失：

```
./data/server/   # 墨染酒馆 SQLite 库（inktavern.db）
./data/cloud/    # 云端公共库（library/*.ink.json + index.json）
```

### 迁移已有数据（可选）
本地已有数据在 `client/server/data/` 与 `cloud/data/`。首次启动前把旧数据复制进宿主机卷目录：

```bash
# 停掉容器后
cp -r client/server/data/. data/server/   # 保留本地剧本/存档/配置
cp -r cloud/data/. data/cloud/            # 保留云端公共库
docker compose up -d                      # 重新启动
```

## 四、常见问题

- **端口被占用**：改 `docker-compose.yml` 里的 `ports` 左侧宿主机端口（如 `"34560:8080"`），云端地址同步改。
- **拉取 golang:1.26-alpine 失败**：确认 Docker Hub 已发布该 tag；否则把两个 Dockerfile 的 `golang:1.26-alpine` 改为已有版本（如 `golang:1.25-alpine`，同时需与 `server/go.mod` 的 `go 1.26` 兼容，一般 1.25 也能编 1.26 语法）。
- **云端 401**：公共库要求 `X-UID` 请求头，墨染酒馆客户端会自动携带；用 curl 直连需加 `-H "X-UID: <10位字母数字>"`。
- **下载 429**：每日下载配额（默认每用户 10 本/天，上传 +3），超限属预期。
