<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { listScripts, getScript, deleteScript, createScript, listSaves, createSave } from '@/api'
import { importScriptFromJSON } from '@/lib/script-import'
import { useConfigStore } from '@/stores/config'
import type { ScriptMeta, Script } from '@/lib/types'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { useToastStore } from '@/stores/toast'
import {
  Plus,
  Play,
  Edit,
  Trash2,
  BookOpen,
  Share2,
  Copy,
  Download,
  Check,
  Settings,
  ImageIcon,
  Upload,
  Loader2,
  Globe,
} from 'lucide-vue-next'

const router = useRouter()
const config = useConfigStore()
const toast = useToastStore()
const scripts = ref<ScriptMeta[]>([])
const loading = ref(true)

// 导入剧本状态
const importInputRef = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const dragOver = ref(false)

// 封面加载失败占位（外链失效时不显示破图）
const coverFailed = reactive(new Set<string>())
function onCoverError(id: string) {
  coverFailed.add(id)
}

// 分享对话框状态
const shareScript = ref<Script | null>(null)
const shareOpen = ref(false)
const copied = ref(false)

// 删除确认状态
const deletingScript = ref<ScriptMeta | null>(null)

/**
 * 打开剧本：无存档时自动创建新档并直接进入引导页（首次游玩不问「要不要创建新档」）；
 * 有存档时进入存档选择页。
 */
async function openScript(id: string) {
  try {
    const saves = await listSaves(id)
    if (saves.length === 0) {
      const sv = await createSave(id)
      router.push(`/play/save?id=${id}&save=${sv.id}`)
    } else {
      router.push(`/play?id=${id}`)
    }
  } catch (err) {
    console.error('打开剧本失败:', err)
    router.push(`/play?id=${id}`)
  }
}

/** 导入任意格式的剧本 JSON：交给 AI 分析提取后创建剧本并跳转编辑器 */
async function handleImportScript(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  await importFile(file)
  ;(e.target as HTMLInputElement).value = ''
}

/** 统一的导入入口（文件选择 + 拖拽共用） */
async function importFile(file: File) {
  if (importing.value) return
  importing.value = true
  try {
    const text = await file.text()
    const script = await importScriptFromJSON(text, (phase) => {
      // 走 AI 分析时给玩家一个预期，避免误以为卡死
      if (phase === 'ai') {
        toast.info('未识别为常见格式，正在用 AI 分析提取，请稍候…（大文件可能需要 1-2 分钟）', 6000)
      }
    })
    const res = await createScript(script)
    toast.success(`剧本「${script.meta.title || '导入的剧本'}」导入成功，已跳转到编辑器。`)
    router.push(`/editor?id=${res.id}`)
  } catch (err) {
    toast.error('导入失败：' + (err instanceof Error ? err.message : String(err)))
  } finally {
    importing.value = false
  }
}

// ==================== 拖拽导入 ====================
function onDragOver(e: DragEvent) {
  e.preventDefault()
  dragOver.value = true
}

function onDragLeave(e: DragEvent) {
  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) {
    dragOver.value = false
  }
}

async function onDrop(e: DragEvent) {
  e.preventDefault()
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  if (!/\.json$/i.test(file.name) && !file.type.includes('json')) {
    toast.warning('请拖入 JSON 格式的剧本文件')
    return
  }
  await importFile(file)
}

async function loadScripts(): Promise<ScriptMeta[]> {
  try {
    return await listScripts()
  } catch (err) {
    console.error('加载剧本列表失败:', err)
    return []
  }
}

function confirmDelete(s: ScriptMeta) {
  deletingScript.value = s
}

async function doDelete() {
  if (!deletingScript.value) return
  const id = deletingScript.value.id
  deletingScript.value = null
  try {
    await deleteScript(id)
    scripts.value = await loadScripts()
    toast.success('剧本已删除')
  } catch (err) {
    toast.error('删除失败：' + (err instanceof Error ? err.message : String(err)))
  }
}

async function handleShare(id: string) {
  try {
    shareScript.value = await getScript(id)
    shareOpen.value = true
    copied.value = false
  } catch (err) {
    console.error('加载剧本失败:', err)
  }
}

function getShareJSON(): string {
  if (!shareScript.value) return ''
  const pack = {
    version: 1,
    type: 'ink-tavern-script' as const,
    exportedAt: Date.now(),
    data: shareScript.value,
  }
  return JSON.stringify(pack, null, 2)
}

async function handleCopyShare() {
  try {
    await navigator.clipboard.writeText(getShareJSON())
    copied.value = true
    toast.success('分享 JSON 已复制到剪贴板')
    setTimeout(() => (copied.value = false), 2000)
  } catch (err) {
    toast.error('复制失败：' + (err instanceof Error ? err.message : String(err)))
  }
}

function handleDownloadShare() {
  const json = getShareJSON()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${shareScript.value?.meta.title || 'script'}.ink.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  toast.success('已下载 .ink.json 文件')
}

onMounted(async () => {
  // 先加载 AI 配置（导入剧本时需要正确的模型，否则 AI 调用会因默认模型不被支持而失败）
  if (!config.loaded) {
    try {
      await config.loadConfig()
    } catch {
      /* ignore */
    }
  }
  scripts.value = await loadScripts()
  loading.value = false
})
</script>

<template>
  <div
    class="min-h-screen bg-zinc-950 text-zinc-100"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- 拖拽导入覆盖层 -->
    <Transition name="fade">
      <div v-if="dragOver" class="fixed inset-0 z-[90] pointer-events-none flex items-center justify-center">
        <div class="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm" @dragover.prevent="onDragOver" @drop.prevent="onDrop" />
        <div class="relative border-2 border-dashed border-amber-500/60 rounded-xl px-10 py-8 bg-zinc-900/90 flex flex-col items-center gap-3">
          <Upload class="w-10 h-10 text-amber-500" />
          <p class="text-zinc-200 font-medium">释放导入剧本 JSON</p>
          <p class="text-xs text-zinc-500">支持春潮 / 风月 / MISS / 日礼 / 春水 / 酒馆 等格式</p>
        </div>
      </div>
    </Transition>

    <!-- 顶栏（移动端：次要操作仅图标，主操作保留文字） -->
    <header class="border-b border-zinc-800 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
      <div class="flex items-center gap-2 sm:gap-3 min-w-0">
        <BookOpen class="w-6 h-6 text-amber-500 shrink-0" />
        <h1 class="text-lg sm:text-xl font-bold truncate">墨染酒馆</h1>
      </div>
      <div class="flex items-center gap-1 sm:gap-2 shrink-0">
        <Button variant="ghost" size="icon" class="h-9 w-9 sm:h-8 sm:w-8" title="设置" @click="router.push('/settings')">
          <Settings class="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-9 w-9 sm:h-9"
          title="公共剧本库"
          @click="router.push('/library')"
        >
          <Globe class="w-4 h-4" />
          <span class="hidden sm:inline sm:ml-1 sm:text-sm">公共剧本库</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-9 w-9 sm:h-9"
          :disabled="importing"
          title="导入剧本"
          @click="importInputRef?.click()"
        >
          <Loader2 v-if="importing" class="w-4 h-4 animate-spin" />
          <Upload v-else class="w-4 h-4" />
          <span class="hidden sm:inline sm:ml-1 sm:text-sm">{{ importing ? 'AI 解析中...' : '导入剧本' }}</span>
        </Button>
        <input ref="importInputRef" type="file" accept=".json" class="hidden" @change="handleImportScript" />
        <Button class="bg-amber-600 hover:bg-amber-500" @click="router.push('/editor?id=new')">
          <Plus class="w-4 h-4 mr-2" />
          新建剧本
        </Button>
      </div>
    </header>

    <!-- 剧本列表 -->
    <main class="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div v-if="loading" class="flex items-center justify-center h-64">
        <p class="text-zinc-500">加载中...</p>
      </div>
      <div v-else-if="scripts.length === 0" class="flex flex-col items-center justify-center h-64 gap-4">
        <BookOpen class="w-16 h-16 text-zinc-700" />
        <p class="text-zinc-500 text-lg">还没有剧本</p>
        <Button variant="outline" class="border-zinc-700" @click="router.push('/editor?id=new')">
          <Plus class="w-4 h-4 mr-2" />
          创建第一个剧本
        </Button>
      </div>
      <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
        <div
          v-for="script in scripts"
          :key="script.id"
          class="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors cursor-pointer group overflow-hidden flex flex-col aspect-[3/4] rounded-lg"
          @click="openScript(script.id)"
        >
          <!-- 上部：封面图 -->
          <div class="relative flex-1 min-h-0 bg-zinc-800">
            <img v-if="script.coverUrl && !coverFailed.has(script.id)" :src="script.coverUrl" :alt="script.title" class="absolute inset-0 w-full h-full object-cover" @error="onCoverError(script.id)" />
            <div v-else class="w-full h-full flex items-center justify-center">
              <ImageIcon class="w-12 h-12 text-zinc-700" />
            </div>
            <!-- 操作按钮：常驻弱化显示，hover 增强 -->
            <div class="absolute top-2 right-2 flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="icon" class="h-8 w-8 bg-zinc-900/80 backdrop-blur hover:bg-zinc-800" title="编辑" @click.stop="router.push(`/editor?id=${script.id}`)">
                <Edit class="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" class="h-8 w-8 bg-zinc-900/80 backdrop-blur hover:bg-zinc-800 text-emerald-500 hover:text-emerald-400" title="游玩" @click.stop="openScript(script.id)">
                <Play class="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" class="h-8 w-8 bg-zinc-900/80 backdrop-blur hover:bg-zinc-800 text-sky-500 hover:text-sky-400" title="分享" @click.stop="handleShare(script.id)">
                <Share2 class="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" class="h-8 w-8 bg-zinc-900/80 backdrop-blur hover:bg-zinc-800 text-red-500 hover:text-red-400" title="删除" @click.stop="confirmDelete(script)">
                <Trash2 class="w-4 h-4" />
              </Button>
            </div>
          </div>
          <!-- 下部：标题、简介、类型 -->
          <div class="p-3 shrink-0 border-t border-zinc-800">
            <h3 class="text-zinc-100 text-sm truncate font-medium">{{ script.title }}</h3>
            <p class="text-zinc-500 text-xs mt-1 line-clamp-2 min-h-[2rem]">{{ script.description || '暂无简介' }}</p>
            <div class="flex flex-wrap gap-1 mt-2">
              <span v-for="tag in script.tags" :key="tag" class="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">
                {{ tag }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 分享对话框 -->
    <Dialog :open="shareOpen" @update:open="shareOpen = $event">
      <div class="p-5">
        <h2 class="text-amber-500 flex items-center gap-2 text-lg font-semibold mb-4">
          <Share2 class="w-4 h-4" />
          分享剧本
        </h2>

        <div v-if="shareScript" class="space-y-4">
          <div class="bg-zinc-800/50 rounded-lg p-3 space-y-2">
            <p class="font-medium text-zinc-200">{{ shareScript.meta.title }}</p>
            <p class="text-sm text-zinc-400 line-clamp-2">{{ shareScript.meta.description || '暂无简介' }}</p>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="tag in shareScript.meta.tags" :key="tag" class="text-xs bg-zinc-700 text-zinc-400 px-2 py-0.5 rounded">
                {{ tag }}
              </span>
            </div>
            <p class="text-xs text-zinc-500">
              Prompt: {{ shareScript.prompt.length > 80 ? shareScript.prompt.slice(0, 80) + '...' : shareScript.prompt || '空' }}
            </p>
            <p class="text-xs text-zinc-500">世界书词条: {{ shareScript.worldbook.length }} 条</p>
          </div>

          <p class="text-xs text-zinc-500">
            导出的 .ink.json 文件可通过「设置 → 数据管理 → 导入备份文件」导入到其他墨染酒馆实例。
          </p>

          <div class="flex gap-2">
            <Button variant="outline" class="border-zinc-700 flex-1" @click="handleCopyShare">
              <template v-if="copied">
                <Check class="w-4 h-4 mr-2 text-green-400" />已复制
              </template>
              <template v-else>
                <Copy class="w-4 h-4 mr-2" />复制 JSON
              </template>
            </Button>
            <Button variant="outline" class="border-zinc-700 flex-1" @click="handleDownloadShare">
              <Download class="w-4 h-4 mr-2" />
              下载 .ink.json
            </Button>
          </div>
        </div>
      </div>
    </Dialog>

    <!-- 删除剧本确认 -->
    <ConfirmDialog
      :open="!!deletingScript"
      title="删除剧本"
      :message="`确定删除剧本「${deletingScript?.title}」？此操作不可恢复，该剧本的所有存档也会一并删除。`"
      confirm-text="删除"
      danger
      @update:open="deletingScript = null"
      @confirm="doDelete"
      @cancel="deletingScript = null"
    />
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
