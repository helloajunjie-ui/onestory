import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 开发期代理 API 到 Go 后端，规避 CORS
      '/api': 'http://localhost:8080',
    },
  },
  build: {
    // 构建产物直接进 Go embed 目录
    outDir: '../server/internal/webui/dist',
    emptyOutDir: true,
  },
})
