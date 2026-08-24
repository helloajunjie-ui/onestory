package main

import (
	"flag"
	"log"
	"net/http"

	"ink-tavern/server/internal/api"
	"ink-tavern/server/internal/store"
)

func main() {
	port := flag.String("port", "8080", "HTTP 服务端口")
	dataDir := flag.String("data", "./data", "数据目录（存放 SQLite 数据库）")
	flag.Parse()

	st, err := store.Open(*dataDir)
	if err != nil {
		log.Fatalf("打开存储失败: %v", err)
	}
	defer st.Close()

	mux := api.NewMux(st)

	addr := ":" + *port
	log.Printf("墨染酒馆已启动: http://localhost%s", addr)
	log.Printf("数据目录: %s", *dataDir)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("服务启动失败: %v", err)
	}
}
