<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useConfigStore } from '@/stores/config'
import { useToastStore } from '@/stores/toast'
import {
  listLibraryScripts,
  getLibraryScript,
  uploadLibraryScript,
  deleteLibraryScript,
  listScripts,
  getScript,
  createScript,
} from '@/api'
import { isInkTavernJSON, parseInkTavernJSON, importScriptFromJSON } from '@/lib/script-import'
import type { LibraryItem, ScriptMeta, Script } from '@/lib/types'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import {
  ArrowLeft,
  Globe,
  Upload,
  Download,
  Import,
  Trash2,
  Search,
  ImageIcon,
  Loader2,
  BookOpen,
  Settings,
} from 'lucide-vue-next'

const router = useRouter()
const config = useConfigStore()
const toast = useToastStore()

const baseUrl = computed(() => config.cloud.libraryBaseUrl.trim())
const uid = computed(() => config.uid)

const items = ref<LibraryItem[]>([])
const loading = ref(false)
const search = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null

// 上传状态
const uploadOpen = ref(false)
const uploading = ref(false)
const uploadTab = ref<'local' | 'file'>('local')
const myScripts = ref<ScriptMeta[]>([])
const selectedScriptId = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)

// 删除确认
const deleting = ref<LibraryItem | null>(null)

const connected = computed(() => !!baseUrl.value)

async function load() {
  if (!baseUrl.value) return
  loading.value = true
  try {
    items.value = await listLibraryScripts(baseUrl.value, uid.value, search.value.trim() || undefined)
  } catch (err) {
    toast.error('加载失败：' + (err instanceof Error ? err.message : String(err)))
  } finally {
    loading.value = false
  }
}

function onSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => load(), 400)
}

// ==================== 上传 ====================
function makeInkJson(script: Script): string {
  const pack = { version: 1, type: 'ink-tavern-script' as const, exportedAt: Date.now(), data: script }
  return JSON.stringify(pack, null, 2)
}

async function openUpload() {
  uploadTab.value = 'local'
  selectedScriptId.value = ''
  uploadOpen.value = true
  try {
    myScripts.value = await listScripts()
  } catch {
    myScripts.value = []
  }
}

async function doUploadFromLocal() {
  if (!selectedScriptId.value) return
  uploading.value = true
  try {
    const script = await getScript(selectedScriptId.value)
    await uploadLibraryScript(baseUrl.value, uid.value, makeInkJson(script))
    toast.success('已上传到公共剧本库')
    uploadOpen.value = false
    await load()
  } catch (err) {
    toast.error('上传失败：' + (err instanceof Error ? err.message : String(err)))
  } finally {
    uploading.value = false
  }
}

async function handleFileUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploading.value = true
  try {
    const text = await file.text()
    // 统一转 .ink.json：自家格式直接透传，其他格式先转换再打包上传
    let inkJson = text
    if (!isInkTavernJSON(text)) {
      const script = await importScriptFromJSON(text)
      inkJson = makeInkJson(script)
    }
    await uploadLibraryScript(baseUrl.value, uid.value, inkJson)
    toast.success('已上传到公共剧本库')
    uploadOpen.value = false
    await load()
  } catch (err) {
    toast.error('上传失败：' + (err instanceof Error ? err.message : String(err)))
  } finally {
    uploading.value = false
    ;(e.target as HTMLInputElement).value = ''
  }
}

// ==================== 下载 / 导入本地 / 删除 ====================
async function handleDownload(item: LibraryItem) {
  try {
    const data = await getLibraryScript(baseUrl.value, uid.value, item.id)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${item.title || 'script'}.ink.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('已下载 .ink.json')
  } catch (err) {
    toast.error('下载失败：' + (err instanceof Error ? err.message : String(err)))
  }
}

async function handleImport(item: LibraryItem) {
  try {
    const data = await getLibraryScript(baseUrl.value, uid.value, item.id)
    const json = JSON.stringify(data)
    let script = parseInkTavernJSON(json)
    if (!script) script = await importScriptFromJSON(json)
    if (!script) throw new Error('剧本解析失败')
    const res = await createScript(script)
    toast.success(`已导入「${script.meta.title || '未命名'}」，可在编辑器中继续修改`)
    router.push(`/editor?id=${res.id}`)
  } catch (err) {
    toast.error('导入失败：' + (err instanceof Error ? err.message : String(err)))
  }
}

async function doDelete() {
  if (!deleting.value) return
  const id = deleting.value.id
  deleting.value = null
  try {
    await deleteLibraryScript(baseUrl.value, uid.value, id)
    toast.success('已从公共库删除')
    await load()
  } catch (err) {
    toast.error('删除失败：' + (err instanceof Error ? err.message : String(err)))
  }
}

onMounted(async () => {
  if (!config.loaded) {
    try {
      await config.loadConfig()
    } catch {
      /* ignore */
    }
  }
  await load()
})
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100">
    <!-- 顶栏（移动端：连接状态与上传文字隐藏，仅图标） -->
    <header class="border-b border-zinc-800 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
      <div class="flex items-center gap-2 sm:gap-3 min-w-0">
        <Button variant="ghost" size="icon" class="h-9 w-9 sm:h-8 sm:w-8 shrink-0" @click="router.push('/')">
          <ArrowLeft class="w-4 h-4" />
        </Button>
        <Globe class="w-5 h-5 text-amber-500 shrink-0" />
        <h1 class="text-base sm:text-lg font-semibold truncate">公共剧本库</h1>
        <span
          class="text-xs px-2 py-0.5 rounded-full shrink-0 hidden sm:inline-flex"
          :class="connected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-500'"
        >
          {{ connected ? '已连接云端' : '未配置云端' }}
        </span>
      </div>
      <div class="flex items-center gap-1 sm:gap-2 shrink-0">
        <Button variant="ghost" size="icon" class="h-9 w-9 sm:h-8 sm:w-8" title="设置" @click="router.push('/settings')">
          <Settings class="w-4 h-4" />
        </Button>
        <Button
          v-if="connected"
          size="icon"
          class="h-9 w-9 sm:h-9 sm:w-auto sm:px-4 bg-amber-600 hover:bg-amber-500"
          title="上传剧本"
          @click="openUpload"
        >
          <Upload class="w-4 h-4" />
          <span class="hidden sm:inline sm:ml-1">上传剧本</span>
        </Button>
      </div>
    </header>

    <main class="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <!-- 未配置云端地址 -->
      <div v-if="!connected" class="flex flex-col items-center justify-center h-64 gap-4">
        <Globe class="w-16 h-16 text-zinc-700" />
        <p class="text-zinc-500 text-lg">尚未配置云端公共剧本库地址</p>
        <p class="text-zinc-600 text-sm text-center max-w-md">在设置中填写云端服务地址即可浏览共享剧本、上传与导入。本地默认 http://localhost:8787（先启动云端服务）。</p>
        <Button variant="outline" class="border-zinc-700" @click="router.push('/settings')">
          <Settings class="w-4 h-4 mr-2" />
          前往设置
        </Button>
      </div>

      <!-- 已配置：搜索 + 列表 -->
      <template v-else>
        <!-- 搜索 -->
        <div class="mb-6 flex gap-2">
          <div class="relative flex-1 max-w-md">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              v-model="search"
              @input="onSearch"
              placeholder="搜索标题 / 简介 / 标签..."
              class="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500 placeholder-zinc-600"
            />
          </div>
          <Button variant="outline" class="border-zinc-700" title="刷新" @click="load">
            <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
            <BookOpen v-else class="w-4 h-4" />
          </Button>
        </div>

        <!-- 列表 -->
        <div v-if="loading" class="flex items-center justify-center h-64">
          <p class="text-zinc-500">加载中...</p>
        </div>
        <div v-else-if="items.length === 0" class="flex flex-col items-center justify-center h-64 gap-3">
          <BookOpen class="w-16 h-16 text-zinc-700" />
          <p class="text-zinc-500">{{ search ? '没有匹配的剧本' : '公共剧本库还是空的' }}</p>
          <p class="text-zinc-600 text-sm">{{ search ? '换个关键词试试' : '点击右上角「上传剧本」分享你的作品' }}</p>
        </div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
          <div
            v-for="item in items"
            :key="item.id"
            class="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors rounded-lg overflow-hidden flex flex-col aspect-[3/4] group"
          >
            <!-- 封面 -->
            <div class="relative flex-1 min-h-0 bg-zinc-800">
              <img v-if="item.coverUrl" :src="item.coverUrl" :alt="item.title" class="absolute inset-0 w-full h-full object-cover" @error="($event.target as HTMLImageElement).style.display = 'none'" />
              <div v-if="!item.coverUrl" class="absolute inset-0 flex items-center justify-center">
                <ImageIcon class="w-12 h-12 text-zinc-700" />
              </div>
              <div class="absolute inset-x-0 bottom-0 flex items-center justify-between px-2.5 py-1.5 bg-gradient-to-t from-black/80 to-transparent text-[10px] text-zinc-300">
                <span>⬇ {{ item.downloadCount }}</span>
                <span v-if="item.author" class="truncate max-w-[60%]" title="上传者 UID">{{ '#' + item.author.slice(0, 6) }}</span>
              </div>
              <!-- 操作按钮：常驻弱化，hover 增强 -->
              <div class="absolute top-2 right-2 flex gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" class="h-9 w-9 sm:h-8 sm:w-8 bg-zinc-900/80 backdrop-blur hover:bg-zinc-800 text-emerald-500 hover:text-emerald-400" title="导入本地" @click.stop="handleImport(item)">
                  <Import class="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" class="h-9 w-9 sm:h-8 sm:w-8 bg-zinc-900/80 backdrop-blur hover:bg-zinc-800 text-sky-500 hover:text-sky-400" title="下载 .ink.json" @click.stop="handleDownload(item)">
                  <Download class="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" class="h-9 w-9 sm:h-8 sm:w-8 bg-zinc-900/80 backdrop-blur hover:bg-zinc-800 text-red-500 hover:text-red-400" title="删除" @click.stop="deleting = item">
                  <Trash2 class="w-4 h-4" />
                </Button>
              </div>
            </div>
            <!-- 信息 -->
            <div class="p-3 shrink-0 border-t border-zinc-800">
              <h3 class="text-zinc-100 text-sm truncate font-medium">{{ item.title }}</h3>
              <p class="text-zinc-500 text-xs mt-1 line-clamp-2 min-h-[2rem]">{{ item.description || '暂无简介' }}</p>
              <div class="flex flex-wrap gap-1 mt-2">
                <span v-for="tag in item.tags.slice(0, 3)" :key="tag" class="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">
                  {{ tag }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </main>

    <!-- 上传对话框 -->
    <Dialog :open="uploadOpen" @update:open="uploadOpen = $event">
      <div class="p-5">
        <h2 class="text-amber-500 flex items-center gap-2 text-lg font-semibold mb-4">
          <Upload class="w-4 h-4" />
          上传剧本到公共库
        </h2>

        <!-- 入口切换 -->
        <div class="flex gap-1 mb-4 bg-zinc-800/60 rounded-lg p-1">
          <button
            @click="uploadTab = 'local'"
            class="flex-1 px-3 py-1.5 rounded text-sm transition-colors"
            :class="uploadTab === 'local' ? 'bg-zinc-700 text-amber-400' : 'text-zinc-400 hover:text-zinc-200'"
          >
            从我的剧本
          </button>
          <button
            @click="uploadTab = 'file'"
            class="flex-1 px-3 py-1.5 rounded text-sm transition-colors"
            :class="uploadTab === 'file' ? 'bg-zinc-700 text-amber-400' : 'text-zinc-400 hover:text-zinc-200'"
          >
            上传文件
          </button>
        </div>

        <div v-if="uploadTab === 'local'" class="space-y-4">
          <select
            v-model="selectedScriptId"
            class="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
            style="color-scheme: dark"
          >
            <option value="" disabled>选择要发布的剧本</option>
            <option v-for="s in myScripts" :key="s.id" :value="s.id">{{ s.title }}</option>
          </select>
          <Button
            :disabled="!selectedScriptId || uploading"
            class="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50"
            @click="doUploadFromLocal"
          >
            <Loader2 v-if="uploading" class="w-4 h-4 mr-2 animate-spin" />
            <Upload v-else class="w-4 h-4 mr-2" />
            {{ uploading ? '上传中...' : '上传到公共库' }}
          </Button>
        </div>

        <div v-else class="space-y-4">
          <input ref="fileInputRef" type="file" accept=".json" class="hidden" @change="handleFileUpload" />
          <button
            @click="fileInputRef?.click()"
            :disabled="uploading"
            class="w-full border-2 border-dashed border-zinc-700 rounded-lg py-8 flex flex-col items-center gap-2 text-zinc-400 hover:border-amber-600 hover:text-amber-500 transition-colors disabled:opacity-50"
          >
            <Upload class="w-8 h-8" />
            <span class="text-sm">{{ uploading ? '上传中...' : '点击选择 .ink.json 或任意格式剧本 JSON' }}</span>
            <span class="text-xs text-zinc-600">其他平台格式会自动转换为墨染酒馆格式后上传</span>
          </button>
        </div>
      </div>
    </Dialog>

    <!-- 删除确认 -->
    <ConfirmDialog
      :open="!!deleting"
      title="删除公共剧本"
      :message="`确定从公共剧本库删除「${deleting?.title}」？此操作会影响其他可访问该库的用户。`"
      confirm-text="删除"
      danger
      @update:open="deleting = null"
      @confirm="doDelete"
      @cancel="deleting = null"
    />
  </div>
</template>
