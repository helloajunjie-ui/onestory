# 墨染酒馆主服务（Go 后端 + Vue 前端，单文件内嵌）
# 多阶段构建：node 构建前端 → golang 编译后端 → alpine 精简运行

# ---------- 阶段 1：Vue 前端构建（vite outDir 指向 server/internal/webui/dist） ----------
FROM node:22-alpine AS web
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------- 阶段 2：Go 后端编译（内嵌前端 dist，modernc SQLite 纯 Go 无需 CGO） ----------
FROM golang:1.26-alpine AS build
WORKDIR /build
COPY server/ ./server/
COPY --from=web /build/server/internal/webui/dist ./server/internal/webui/dist
WORKDIR /build/server
RUN go mod download
RUN CGO_ENABLED=0 go build -trimpath -o /ink-tavern .

# ---------- 阶段 3：运行（精简 alpine） ----------
FROM alpine:3.20
WORKDIR /app
COPY --from=build /ink-tavern .
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["./ink-tavern", "-port", "8080", "-data", "/data"]
