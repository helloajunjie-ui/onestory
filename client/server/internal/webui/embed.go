package webui

import "embed"

// Dist 内嵌 Vue 构建产物（npm run build 输出到 dist/，随后 go build 打包）。
// 注意：embed.FS 不含以 . 或 _ 开头的文件。
//
//go:embed dist
var Dist embed.FS
