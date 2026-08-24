#!/usr/bin/env bash
# ============================================================
# 墨染酒馆 · 本地独立部署（不依赖 Docker / 云端公共库）
#
# 用法（Git Bash / Linux 均可）：
#   ./start-local.sh              # 一键：构建 + 启动主服务 + 本地公共库
#   ./start-local.sh --main-only  # 仅启动主服务（公共库是云端/暂不需要）
#
# 说明：
#   - 主服务     ink-tavern.exe  →  http://localhost:8080
#   - 本地公共库 cloud-server.exe →  http://localhost:8787（可选）
#   - 云端部署是另一套（docker compose），与本脚本互不影响
# ============================================================
set -e
cd "$(dirname "$0")"

MAIN_ONLY=0
[ "$1" = "--main-only" ] && MAIN_ONLY=1

# 停掉可能残留的旧进程，避免端口冲突
taskkill //F //IM ink-tavern.exe 2>/dev/null || true
taskkill //F //IM cloud-server.exe 2>/dev/null || true
sleep 1

echo "▶ 构建前端（vite → server/internal/webui/dist）..."
cd web
[ -d node_modules ] || npm ci
npm run build

echo "▶ 构建后端主服务..."
cd ../server
go build -o ink-tavern.exe .

echo "▶ 启动主服务（:8080）..."
./ink-tavern.exe -port 8080 -data ./data &
MAIN_PID=$!

if [ "$MAIN_ONLY" = "0" ]; then
  echo "▶ 构建本地公共库..."
  cd ../../cloud   # 从 client/server → 根/cloud
  go build -o cloud-server.exe .
  echo "▶ 启动本地公共库（:8787）..."
  ./cloud-server.exe -port 8787 -data ./data &
  CLOUD_PID=$!
  sleep 1
  # 自动把本地公共库地址写入设置页，免手填
  curl -s -X PUT http://localhost:8080/api/settings/cloud \
    -H "Content-Type: application/json" \
    -d '{"libraryBaseUrl":"http://localhost:8787"}' >/dev/null 2>&1 || true
fi

echo ""
echo "=========================================="
echo "✅ 墨染酒馆：  http://localhost:8080"
[ "$MAIN_ONLY" = "0" ] && echo "✅ 本地公共库： http://localhost:8787"
echo ""
echo "  停止：按 Ctrl+C，或执行："
echo "    taskkill /F /IM ink-tavern.exe /IM cloud-server.exe"
echo "=========================================="
echo ""

wait $MAIN_PID
