<script setup lang="ts">
// 对话游玩页（移植自 src/app/play/save/page.tsx）
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useConfigStore } from '@/stores/config'
import { getScript, getSave, listSaves, createSave, updateSave, updateScript, loadBgImage, saveBgImage, fetchModels as apiFetchModels } from '@/api'
import { scanWorldbook } from '@/lib/worldbook-scanner'
import { useChatEngine } from '@/composables/useChatEngine'
import { logger } from '@/lib/logger'
import type { Script, SaveData, Message, WorldbookEntry, SaveMeta } from '@/lib/types'
import Button from '@/components/ui/Button.vue'
import GuideFrame from '@/components/GuideFrame.vue'
import MessageList from '@/components/chat/MessageList.vue'
import {
  ArrowLeft,
  Send,
  Pencil,
  Trash2,
  Settings,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  BookOpen,
  Plus,
  X,
  Zap,
  List,
  Square,
  ArrowDown,
} from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const scriptId = String(route.query.id ?? '')
const saveId = String(route.query.save ?? '')
const config = useConfigStore()

const localBgImage = ref('')
const script = ref<Script | null>(null)
const saveData = ref<SaveData | null>(null)
const input = ref('')
const loading = ref(true)
const streaming = ref(false)
const showGuide = ref(false)
const streamContent = ref('')
const editingMsgId = ref<string | null>(null)
const editContent = ref('')
const thinking = ref(false)
const worldbookOpen = ref(false)
const newEntryName = ref('')
const newEntryType = ref('')
const newEntryTriggers = ref('')
const newEntryContent = ref('')
const newEntryOpen = ref(false)
const editingEntry = ref<{ source: 'static' | 'dynamic'; index: number } | null>(null)
const editEntryName = ref('')
const editEntryType = ref('')
const editEntryTriggers = ref('')
const editEntryContent = ref('')
const useStreamMode = ref(true)
const saveList = ref<SaveMeta[]>([])
const saveListOpen = ref(false)
const modelList = ref<string[]>([])
const modelListOpen = ref(false)
const loadingModels = ref(false)
const worldbookHits = ref<WorldbookEntry[]>([])
const streamError = ref<string | null>(null)

const messagesEndRef = ref<HTMLDivElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const scrollContainerRef = ref<HTMLDivElement | null>(null)

// ==================== 对话历史分页（每页 50 回合） ====================
const TURNS_PER_PAGE = 50
const currentPage = ref(0)

function getTotalPages(history: Message[]): number {
  const turnCount = new Set(history.map((m) => m.turn)).size
  return Math.max(1, Math.ceil(turnCount / TURNS_PER_PAGE))
}

const totalPages = computed(() => {
  if (!saveData.value) return 1
  const turns = Array.from(new Set(saveData.value.history.map((m) => m.turn))).sort((a, b) => a - b)
  return Math.max(1, Math.ceil(turns.length / TURNS_PER_PAGE))
})

const visibleMessages = computed(() => {
  if (!saveData.value) return []
  const turns = Array.from(new Set(saveData.value.history.map((m) => m.turn))).sort((a, b) => a - b)
  const pageTurns = new Set(
    turns.slice(currentPage.value * TURNS_PER_PAGE, (currentPage.value + 1) * TURNS_PER_PAGE)
  )
  return saveData.value.history.filter((m) => pageTurns.has(m.turn))
})

// 引导页 HTML：仅使用剧本自带的引导页，没有则保持空（不额外生成）
const guideHtml = computed(() => script.value?.guide || '')

// 越界回退（替代 React 渲染期调整）
watch([totalPages, currentPage], () => {
  if (currentPage.value >= totalPages.value) {
    currentPage.value = Math.max(0, totalPages.value - 1)
  }
})

function scrollToBottom() {
  messagesEndRef.value?.scrollIntoView({ behavior: 'smooth' })
}

// 最新页自动滚动到底部
watch(
  [() => saveData.value?.history, streamContent, currentPage, totalPages],
  () => {
    if (currentPage.value === totalPages.value - 1) scrollToBottom()
  }
)

// 翻页滚动：最新页到底部，历史页到顶部
watch([currentPage, totalPages], () => {
  const el = scrollContainerRef.value
  if (!el) return
  if (currentPage.value === totalPages.value - 1) el.scrollTop = el.scrollHeight
  else el.scrollTop = 0
})

// ==================== 到底部按钮 ====================
const showGoBottom = ref(false)

function onScroll() {
  const el = scrollContainerRef.value
  if (!el) return
  const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80
  showGoBottom.value = !nearBottom
}

function goToBottom() {
  scrollContainerRef.value?.scrollTo({
    top: scrollContainerRef.value.scrollHeight,
    behavior: 'smooth',
  })
}

function goToLatest() {
  currentPage.value = totalPages.value - 1
  requestAnimationFrame(() => scrollToBottom())
}

// ==================== 统一对话执行引擎 ====================
const { executeChat, stop: stopChat } = useChatEngine({
  script,
  useStreamMode,
  onStreamToken: (token) => {
    streamContent.value += token
  },
  onStreamDone: () => {},
  onStreamError: (error) => {
    streamError.value = error.message
  },
  onSaveDataUpdate: (withAi) => {
    saveData.value = withAi
  },
  // L2 函数式合并 dynamicWorldbook，避免 stale closure 覆盖新消息
  onL2Update: (updated) => {
    const prev = saveData.value
    if (!prev) {
      saveData.value = updated
      return
    }
    const merged: SaveData = { ...prev, dynamicWorldbook: updated.dynamicWorldbook }
    updateSave(saveId, merged).catch((e) => console.error('[L2] 存储写入失败:', e))
    saveData.value = merged
  },
  onPageUpdate: (total) => {
    currentPage.value = total - 1
  },
  onStreamingChange: (s) => {
    streaming.value = s
  },
  onThinkingChange: (t) => {
    thinking.value = t
  },
  // 流式失败自动降级后，同步把「流/非流」模式切到非流，防止下次重复失败
  onAutoSwitchMode: () => {
    useStreamMode.value = false
  },
})

function handleStop() {
  stopChat()
  streaming.value = false
  streamContent.value = ''
  thinking.value = false
}

// ==================== 加载数据 ====================
onMounted(async () => {
  // 先确保配置加载（模型列表需要 apiKey）
  if (!config.loaded) {
    try {
      await config.loadConfig()
    } catch {
      /* ignore */
    }
  }
  if (config.aiConfig.apiKey) {
    loadingModels.value = true
    try {
      const list = await apiFetchModels()
      if (list && list.length) modelList.value = list
    } catch (err) {
      console.error('获取模型列表失败:', err)
    } finally {
      loadingModels.value = false
    }
  }

  try {
    const [s, sv, bg, saves] = await Promise.all([
      getScript(scriptId),
      getSave(saveId),
      loadBgImage(),
      listSaves(scriptId),
    ])
    script.value = s
    saveData.value = sv
    if (bg) localBgImage.value = bg
    saveList.value = saves
    // 新存档且剧本带引导页时，显示引导页（正规开始流程）；无引导页的剧本直接进入对话
    if (sv.history.length === 0 && s.guide) {
      logger.info('Conversation', '触发 setShowGuide(true)：新存档且存在引导页')
      showGuide.value = true
    }
  } catch (err) {
    logger.error('Conversation', `loadData 失败: ${err instanceof Error ? err.message : String(err)}`)
    console.error('加载失败:', err)
  } finally {
    loading.value = false
  }
})

// ==================== 引导页提交 ====================
async function handleGuideSubmit(data: Record<string, string>) {
  if (!saveData.value || !script.value || streaming.value) return
  logger.info('Conversation', `引导页提交角色数据 keys=${Object.keys(data).join(',')}`)
  showGuide.value = false

  const roleText = Object.entries(data)
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  if (!roleText) {
    logger.warn('Conversation', '引导页提交无有效角色数据，仅关闭引导页')
    return
  }

  const turn = saveData.value.meta.turnCount + 1
  const userMsg: Message = {
    id: crypto.randomUUID(),
    role: 'user',
    content: roleText,
    timestamp: Date.now(),
    turn,
    edited: false,
    regenerated: false,
  }
  const updatedSave: SaveData = {
    ...saveData.value,
    meta: { ...saveData.value.meta, turnCount: turn, updatedAt: Date.now() },
    history: [...saveData.value.history, userMsg],
  }
  await updateSave(saveId, updatedSave)
  saveData.value = updatedSave
  worldbookHits.value = []
  streaming.value = true
  streamContent.value = ''
  await executeChat({ userInput: roleText, baseSave: updatedSave, turn })
}

// ==================== 发送消息 ====================
async function handleSend() {
  const text = input.value.trim()
  if (!text || !saveData.value || !script.value || streaming.value) return
  if (showGuide.value) showGuide.value = false
  streamError.value = null

  const turn = saveData.value.meta.turnCount + 1
  const userMsg: Message = {
    id: crypto.randomUUID(),
    role: 'user',
    content: text,
    timestamp: Date.now(),
    turn,
    edited: false,
    regenerated: false,
  }
  const updatedSave: SaveData = {
    ...saveData.value,
    meta: { ...saveData.value.meta, turnCount: turn, updatedAt: Date.now() },
    history: [...saveData.value.history, userMsg],
  }
  await updateSave(saveId, updatedSave)
  saveData.value = updatedSave
  input.value = ''
  if (inputRef.value) inputRef.value.style.height = '42px'
  worldbookHits.value = []
  streaming.value = true
  streamContent.value = ''
  await executeChat({ userInput: text, baseSave: updatedSave, turn })
}

// ==================== 消息操作 ====================
async function handleDeleteMessage(msgId: string) {
  if (!saveData.value || streaming.value) return
  const idx = saveData.value.history.findIndex((m) => m.id === msgId)
  if (idx === -1) return
  const updated: SaveData = {
    ...saveData.value,
    meta: { ...saveData.value.meta, updatedAt: Date.now() },
    history: saveData.value.history.slice(0, idx),
  }
  await updateSave(saveId, updated)
  saveData.value = updated
  currentPage.value = Math.min(currentPage.value, getTotalPages(updated.history) - 1)
}

async function handleRegenerate() {
  if (!saveData.value || saveData.value.history.length < 2 || streaming.value) return
  streamError.value = null

  let lastAiIdx = -1
  for (let i = saveData.value.history.length - 1; i >= 0; i--) {
    if (saveData.value.history[i].role === 'assistant') {
      lastAiIdx = i
      break
    }
  }
  if (lastAiIdx === -1) return

  const truncated = saveData.value.history.slice(0, lastAiIdx)
  const updated: SaveData = {
    ...saveData.value,
    meta: { ...saveData.value.meta, updatedAt: Date.now() },
    history: truncated,
  }
  await updateSave(saveId, updated)
  saveData.value = updated
  currentPage.value = Math.min(currentPage.value, getTotalPages(updated.history) - 1)

  let lastUserMsg: Message | null = null
  for (let i = truncated.length - 1; i >= 0; i--) {
    if (truncated[i].role === 'user') {
      lastUserMsg = truncated[i]
      break
    }
  }
  if (!lastUserMsg || !script.value) return

  thinking.value = true
  scrollToBottom()
  await new Promise((r) => setTimeout(r, 100))
  streaming.value = true
  streamContent.value = ''
  thinking.value = false

  await executeChat({
    userInput: lastUserMsg.content,
    baseSave: updated,
    turn: lastUserMsg.turn,
    regenerated: true,
  })
}

async function handleEditSave(msgId: string) {
  if (!saveData.value || !script.value || streaming.value) return
  const newContent = editContent.value.trim()
  if (!newContent) return
  streamError.value = null

  const msg = saveData.value.history.find((m) => m.id === msgId)
  if (!msg) return
  if (newContent === msg.content) {
    editingMsgId.value = null
    return
  }

  const idx = saveData.value.history.findIndex((m) => m.id === msgId)
  const truncated = saveData.value.history.slice(0, idx)
  const editedMsg: Message = { ...msg, content: newContent, edited: true }
  truncated.push(editedMsg)

  const updated: SaveData = {
    ...saveData.value,
    meta: { ...saveData.value.meta, updatedAt: Date.now() },
    history: truncated,
  }
  await updateSave(saveId, updated)
  saveData.value = updated
  editingMsgId.value = null
  currentPage.value = Math.min(currentPage.value, getTotalPages(updated.history) - 1)

  thinking.value = true
  scrollToBottom()
  await new Promise((r) => setTimeout(r, 100))
  streaming.value = true
  streamContent.value = ''
  thinking.value = false

  await executeChat({ userInput: newContent, baseSave: updated, turn: editedMsg.turn })
}

function copyMessage(content: string) {
  navigator.clipboard.writeText(content)
}

// ==================== 类型颜色映射 ====================
const typeColors: Record<string, string> = {
  人物: 'text-sky-400',
  物品: 'text-amber-400',
  地点: 'text-emerald-400',
  事件: 'text-rose-400',
  组织: 'text-violet-400',
}
function getTypeColor(type: string): string {
  return typeColors[type] ?? 'text-zinc-400'
}

// ==================== 输入框处理 ====================
function onInputChange(e: Event) {
  const el = e.target as HTMLTextAreaElement
  input.value = el.value
  el.style.height = 'auto'
  el.style.height = `${Math.min(160, Math.max(42, el.scrollHeight))}px`
  if (script.value && saveData.value && el.value.trim()) {
    const { staticHits, dynamicHits } = scanWorldbook(el.value, script.value.worldbook, saveData.value.dynamicWorldbook)
    worldbookHits.value = [...staticHits, ...dynamicHits]
  } else {
    worldbookHits.value = []
  }
}

function onInputKeyDown(e: KeyboardEvent) {
  // Enter 发送，Shift+Enter 换行，中文输入法组合时不触发
  const ev = e as KeyboardEvent & { isComposing?: boolean }
  if (e.key === 'Enter' && !e.shiftKey && !ev.isComposing) {
    e.preventDefault()
    handleSend()
  }
}

// ==================== 背景图 ====================
function onBgUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async (ev) => {
    const dataUrl = ev.target?.result as string
    localBgImage.value = dataUrl
    await saveBgImage(dataUrl)
  }
  reader.readAsDataURL(file)
}

async function clearBg() {
  localBgImage.value = ''
  await saveBgImage('')
}

// ==================== 世界书抽屉操作 ====================
async function saveStaticEntry(i: number) {
  if (!script.value) return
  const updated = [...script.value.worldbook]
  updated[i] = {
    ...updated[i],
    name: editEntryName.value,
    type: editEntryType.value,
    triggers: editEntryTriggers.value.split(',').map((s) => s.trim()).filter(Boolean),
    content: editEntryContent.value,
  }
  script.value = { ...script.value, worldbook: updated }
  await updateScript(scriptId, { worldbook: updated })
  editingEntry.value = null
}

async function deleteStaticEntry(i: number) {
  if (!script.value) return
  const updated = script.value.worldbook.filter((_, idx) => idx !== i)
  script.value = { ...script.value, worldbook: updated }
  await updateScript(scriptId, { worldbook: updated })
}

async function saveDynamicEntry(i: number) {
  if (!saveData.value) return
  const updated = [...saveData.value.dynamicWorldbook]
  updated[i] = {
    ...updated[i],
    name: editEntryName.value,
    type: editEntryType.value,
    triggers: editEntryTriggers.value.split(',').map((s) => s.trim()).filter(Boolean),
    content: editEntryContent.value,
  }
  const newSave: SaveData = { ...saveData.value, dynamicWorldbook: updated }
  saveData.value = newSave
  await updateSave(saveId, { dynamicWorldbook: updated })
  editingEntry.value = null
}

async function deleteDynamicEntry(i: number) {
  if (!saveData.value) return
  const updated = saveData.value.dynamicWorldbook.filter((_, idx) => idx !== i)
  const newSave: SaveData = { ...saveData.value, dynamicWorldbook: updated }
  saveData.value = newSave
  await updateSave(saveId, { dynamicWorldbook: updated })
}

function startEditEntry(entry: WorldbookEntry, source: 'static' | 'dynamic', index: number) {
  editEntryName.value = entry.name
  editEntryType.value = entry.type
  editEntryTriggers.value = entry.triggers.join(', ')
  editEntryContent.value = entry.content
  editingEntry.value = { source, index }
}

async function addWorldbookEntry() {
  if (!script.value || !saveData.value) return
  if (!newEntryName.value.trim() || !newEntryContent.value.trim()) return
  const entry: WorldbookEntry = {
    name: newEntryName.value.trim(),
    type: newEntryType.value.trim() || '自定义',
    triggers: newEntryTriggers.value.split(',').map((s) => s.trim()).filter(Boolean),
    content: newEntryContent.value.trim(),
    firstAppeared: saveData.value.meta.turnCount,
    lastAppeared: saveData.value.meta.turnCount,
    active: true,
  }
  const updatedWorldbook = [...script.value.worldbook, entry]
  script.value = { ...script.value, worldbook: updatedWorldbook }
  await updateScript(scriptId, { worldbook: updatedWorldbook })
  newEntryName.value = ''
  newEntryType.value = ''
  newEntryTriggers.value = ''
  newEntryContent.value = ''
}

async function handleNewSave() {
  const newId = await createSave(scriptId)
  router.push(`/play/save?id=${scriptId}&save=${newId.id}`)
  saveListOpen.value = false
}

// ==================== 分页页码折叠 ====================
function buildPageItems(): (number | '...')[] {
  const pages: (number | '...')[] = []
  const total = totalPages.value
  const cur = currentPage.value
  if (total <= 7) {
    for (let i = 0; i < total; i++) pages.push(i)
  } else {
    const start = Math.max(0, Math.min(cur - 2, total - 5))
    const end = Math.min(total - 1, start + 4)
    if (start > 0) pages.push(0)
    if (start > 1) pages.push('...')
    for (let i = start; i <= end; i++) pages.push(i)
    if (end < total - 2) pages.push('...')
    if (end < total - 1) pages.push(total - 1)
  }
  return pages
}
</script>

<template>
  <div
    v-if="loading"
    class="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center"
  >
    <p class="text-zinc-500">加载中...</p>
  </div>
  <div
    v-else-if="!script || !saveData"
    class="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center"
  >
    <Button variant="outline" @click="router.push('/')">返回首页</Button>
  </div>
  <div
    v-else
    class="h-screen w-full bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden relative"
    :style="{
      '--app-font-size': config.appearance.fontSize + 'px',
      '--bubble-bg-opacity': config.appearance.bubbleOpacity / 100,
      '--header-opacity': config.appearance.headerOpacity / 100,
    }"
  >
    <!-- 背景层 + 黑色遮罩 -->
    <template v-if="localBgImage">
      <div class="absolute inset-0 bg-cover bg-center bg-fixed pointer-events-none" :style="{ backgroundImage: `url(${localBgImage})`, zIndex: 0 }" />
      <!-- 背景压暗遮罩（强度可调） -->
      <div class="absolute inset-0 pointer-events-none" :style="{ zIndex: 1, backgroundColor: 'rgba(0,0,0,' + config.appearance.bgDim / 100 + ')' }" />
    </template>

    <!-- 顶栏（半透明深色背景 + 模糊，避免背景图干扰操作按钮，透明度可调） -->
    <header
      class="h-14 border-b border-zinc-800 px-4 flex items-center justify-between shrink-0 relative z-10 backdrop-blur-md"
      :style="{ backgroundColor: 'rgba(9,9,11,' + config.appearance.headerOpacity / 100 + ')' }"
    >
      <div class="flex items-center gap-3 min-w-0">
        <Button variant="ghost" size="icon" class="h-9 w-9 sm:h-8 sm:w-8 shrink-0" @click="router.push(`/play?id=${scriptId}`)">
          <ArrowLeft class="w-4 h-4" />
        </Button>
        <div class="min-w-0">
          <h1 class="text-sm font-semibold truncate">{{ script.meta.title }}</h1>
          <p class="text-xs text-zinc-500 truncate">{{ saveData.meta.name }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <!-- 模型选择下拉 -->
        <div class="relative">
          <button
            @click="modelListOpen = !modelListOpen"
            class="flex items-center gap-1 px-2.5 py-2 sm:py-1 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
            title="切换模型"
          >
            <Zap class="w-3 h-3 text-amber-500" />
            <span class="max-w-[100px] truncate hidden sm:inline">{{ config.aiConfig.model }}</span>
          </button>
          <template v-if="modelListOpen">
            <!-- 关闭遮罩从顶栏下方开始，避免挡住顶部操作按钮 -->
            <div class="fixed inset-x-0 top-14 bottom-0 z-40" @click="modelListOpen = false" />
            <div class="absolute right-0 top-full mt-1 z-50 w-48 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
              <div v-if="loadingModels" class="px-3 py-2 text-xs text-zinc-500">加载中...</div>
              <div v-else-if="modelList.length === 0" class="px-3 py-2 text-xs text-zinc-500">未获取到模型列表</div>
              <button
                v-for="m in modelList"
                :key="m"
                @click="config.setAiConfig({ model: m }); modelListOpen = false"
                class="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-800 transition-colors"
                :class="m === config.aiConfig.model ? 'text-amber-400 bg-zinc-800/50' : 'text-zinc-300'"
              >
                {{ m }}
              </button>
            </div>
          </template>
        </div>
        <span class="text-xs text-zinc-600 hidden sm:inline">回合 {{ saveData.meta.turnCount }}</span>
        <Button variant="ghost" size="icon" class="h-9 w-9 sm:h-8 sm:w-8" @click="worldbookOpen = !worldbookOpen" title="世界书">
          <BookOpen class="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" class="h-9 w-9 sm:h-8 sm:w-8" @click="router.push('/settings')" title="AI 设置">
          <Settings class="w-4 h-4" />
        </Button>
      </div>
    </header>

    <!-- 主体：左对话区 + 右世界书抽屉 -->
    <div class="flex flex-1 overflow-hidden">
      <!-- 左侧对话区 -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <!-- 对话消息区 -->
        <div class="relative flex-1 overflow-hidden">
          <div ref="scrollContainerRef" class="h-full overflow-y-auto w-full bg-gradient-to-b from-zinc-950 via-zinc-900/5 to-zinc-950" @scroll="onScroll">
            <div class="max-w-4xl mx-auto w-full px-4 py-6 space-y-4">
            <!-- 引导页（新档正规流程；有引导页用剧本自带，无则用默认开始页） -->
            <div v-if="showGuide" class="w-full">
              <GuideFrame
                :html="guideHtml"
                @submit="handleGuideSubmit"
                @close="showGuide = false"
              />
            </div>

            <!-- 空历史提示 -->
            <div v-if="saveData.history.length === 0 && !showGuide" class="text-center py-16">
              <p class="text-zinc-500">开始你的故事...</p>
              <p class="text-xs text-zinc-600 mt-2">在下方输入框发送第一条消息</p>
            </div>

            <!-- 分页控件 -->
            <div v-if="totalPages > 1" class="flex flex-col items-center gap-2 py-3">
              <span class="text-[11px] text-zinc-500">
                第 {{ currentPage * TURNS_PER_PAGE + 1 }}-
                {{ Math.min((currentPage + 1) * TURNS_PER_PAGE, saveData.history.length) }} 回合 · 共 {{ saveData.history.length }} 回合
              </span>
              <div class="flex items-center gap-1.5 flex-wrap justify-center">
                <button
                  @click="currentPage = Math.max(0, currentPage - 1)"
                  :disabled="currentPage === 0"
                  class="px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800/80 border border-zinc-700 text-zinc-300 hover:bg-zinc-700/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ‹
                </button>
                <template v-for="(p, idx) in buildPageItems()" :key="p === '...' ? 'e' + idx : p">
                  <span v-if="p === '...'" class="px-1 text-xs text-zinc-600">…</span>
                  <button
                    v-else
                    @click="currentPage = p"
                    class="w-7 h-7 rounded-lg text-xs transition-colors"
                    :class="p === currentPage ? 'bg-amber-600 text-white font-medium' : 'bg-zinc-800/80 border border-zinc-700 text-zinc-400 hover:bg-zinc-700/80'"
                  >
                    {{ p + 1 }}
                  </button>
                </template>
                <button
                  @click="currentPage = Math.min(totalPages - 1, currentPage + 1)"
                  :disabled="currentPage >= totalPages - 1"
                  class="px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800/80 border border-zinc-700 text-zinc-300 hover:bg-zinc-700/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ›
                </button>
                <button
                  v-if="currentPage !== totalPages - 1"
                  @click="goToLatest"
                  class="px-2.5 py-1.5 rounded-lg text-xs bg-amber-600/20 border border-amber-700/50 text-amber-400 hover:bg-amber-600/30 transition-colors"
                >
                  回到最新
                </button>
              </div>
            </div>

            <MessageList
              :visible-messages="visibleMessages"
              :save-data="saveData"
              :streaming="streaming"
              :stream-content="streamContent"
              :thinking="thinking"
              :current-page="currentPage"
              :total-pages="totalPages"
              :editing-msg-id="editingMsgId"
              :edit-content="editContent"
              :appearance="{ fontSize: config.appearance.fontSize, textColor: config.appearance.textColor }"
              @edit-content-change="editContent = $event"
              @edit-save="handleEditSave"
              @edit-cancel="editingMsgId = null"
              @start-edit="(id: string, content: string) => { editingMsgId = id; editContent = content }"
              @regenerate="handleRegenerate"
              @delete="handleDeleteMessage"
              @copy="copyMessage"
            />
            <div ref="messagesEndRef" />
          </div>
          <!-- 到底部按钮：滚动离开底部时显示，点击平滑回到最新内容 -->
          <button
            v-if="showGoBottom"
            @click="goToBottom"
            title="到底部"
            class="absolute bottom-4 right-6 z-10 w-9 h-9 rounded-full bg-zinc-800/90 border border-zinc-700 text-zinc-300 hover:text-amber-400 hover:bg-zinc-700 flex items-center justify-center shadow-lg transition-colors"
          >
            <ArrowDown class="w-4 h-4" />
          </button>
          </div>
        </div>

        <!-- 快捷外观控制栏 -->
        <div class="border-t border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md px-4 py-2 shrink-0">
          <div class="flex items-center gap-3 max-w-4xl mx-auto">
            <label class="flex items-center gap-1.5 px-2 py-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 cursor-pointer transition-colors text-xs" title="更换背景">
              <ImageIcon class="w-3.5 h-3.5" />
              <span class="hidden sm:inline">背景</span>
              <input type="file" accept="image/*" class="hidden" @change="onBgUpload" />
            </label>
            <button
              v-if="localBgImage"
              @click="clearBg"
              class="flex items-center gap-1.5 px-2 py-1 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800/50 transition-colors text-xs"
              title="清除背景"
            >
              <Trash2 class="w-3 h-3" />
            </button>
            <div class="w-px h-4 bg-zinc-800" />
            <button
              @click="config.setAppearance({ fontSize: Math.max(14, config.appearance.fontSize - 2) })"
              class="px-2 py-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors text-xs"
              title="缩小字号"
            >
              A⁻
            </button>
            <span class="text-xs text-zinc-500 font-mono w-8 text-center">{{ config.appearance.fontSize }}</span>
            <button
              @click="config.setAppearance({ fontSize: Math.min(42, config.appearance.fontSize + 2) })"
              class="px-2 py-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors text-xs"
              title="增大字号"
            >
              A⁺
            </button>
            <select
              :value="config.appearance.textColor"
              @change="config.setAppearance({ textColor: ($event.target as HTMLSelectElement).value })"
              class="bg-zinc-900 border border-zinc-700 rounded text-[10px] text-zinc-300 px-1 py-0.5 cursor-pointer outline-none focus:border-amber-600"
              title="文字颜色"
              style="color-scheme: dark"
            >
              <option value="#e4e4e7">默认</option>
              <option value="#000000">纯黑</option>
              <option value="#1a1a1a">近黑</option>
              <option value="#3f3f46">深灰</option>
              <option value="#52525b">中灰</option>
              <option value="#ffffff">纯白</option>
              <option value="#f5f0e8">米白</option>
              <option value="#d4d4d8">浅灰</option>
            </select>
            <div class="flex-1" />
          </div>
        </div>

        <!-- 流模式 + 存档选择栏 -->
        <div class="border-t border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md px-4 py-1.5 shrink-0">
          <div class="flex items-center gap-3 max-w-4xl mx-auto">
            <button
              @click="useStreamMode = !useStreamMode"
              class="flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors"
              :class="useStreamMode ? 'text-amber-400 bg-amber-500/10' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'"
              :title="useStreamMode ? '流式模式（打字机效果）' : '非流模式（一次性返回）'"
            >
              <Zap class="w-3 h-3" :class="useStreamMode ? 'text-amber-400' : ''" />
              {{ useStreamMode ? '流式' : '非流' }}
            </button>
            <div class="w-px h-3 bg-zinc-800" />
            <div class="relative">
              <button
                @click="saveListOpen = !saveListOpen"
                class="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors"
                title="切换存档"
              >
                <List class="w-3 h-3" />
                <span class="max-w-[120px] truncate">{{ saveData.meta.name }}</span>
              </button>
              <template v-if="saveListOpen">
                <!-- 关闭遮罩从顶栏下方开始，避免挡住顶部操作按钮 -->
                <div class="fixed inset-x-0 top-14 bottom-0 z-40" @click="saveListOpen = false" />
                <div class="absolute left-0 bottom-full mb-1 z-50 w-52 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                  <button
                    v-for="s in saveList"
                    :key="s.id"
                    @click="router.push(`/play/save?id=${scriptId}&save=${s.id}`); saveListOpen = false"
                    class="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-800 transition-colors"
                    :class="s.id === saveId ? 'text-amber-400 bg-zinc-800/50' : 'text-zinc-300'"
                  >
                    <div class="truncate">{{ s.name }}</div>
                    <div class="text-[10px] text-zinc-600">回合 {{ s.turnCount }}</div>
                  </button>
                  <div class="border-t border-zinc-800">
                    <button
                      @click="handleNewSave"
                      class="w-full text-left px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                    >
                      + 新建存档
                    </button>
                  </div>
                </div>
              </template>
            </div>
            <div class="flex-1" />
          </div>
        </div>

        <!-- 世界书命中词条气泡 -->
        <div v-if="worldbookHits.length > 0" class="border-t border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md px-4 py-1.5 shrink-0">
          <div class="flex items-center gap-1.5 max-w-4xl mx-auto flex-wrap">
            <span
              v-for="(entry, i) in worldbookHits"
              :key="'hit-' + i"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-800/80 border border-zinc-700/60 text-zinc-300"
              :title="`${entry.type}: ${entry.content}`"
            >
              <span class="w-1.5 h-1.5 rounded-full" :class="entry.active ? 'bg-green-500' : 'bg-zinc-600'" />
              {{ entry.name }}
              <span class="text-zinc-600">·</span>
              <span class="text-zinc-500">{{ entry.type }}</span>
            </span>
          </div>
        </div>

        <!-- 输入栏 -->
        <div class="border-t border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md px-4 py-3 shrink-0">
          <div v-if="streamError" class="max-w-4xl mx-auto mb-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            <span class="flex-1 break-words">
              ⚠️ {{ streamError }}
              <span class="block text-red-500/70 mt-0.5">请在设置中检查 API 配置后重试。</span>
            </span>
            <button @click="streamError = null" class="shrink-0 p-0.5 rounded hover:bg-red-500/20 transition-colors" title="关闭">
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
          <div class="flex gap-2 max-w-4xl mx-auto">
            <textarea
              ref="inputRef"
              :value="input"
              @input="onInputChange"
              @keydown="onInputKeyDown"
              :placeholder="streaming ? 'AI 正在回复中，可继续输入草稿...' : '输入你的行动或对话...（Enter 发送，Shift+Enter 换行）'"
              rows="1"
              class="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500 placeholder-zinc-600 resize-none leading-relaxed"
              style="min-height: 42px; max-height: 160px"
            />
            <Button
              v-if="streaming || thinking"
              @click="handleStop"
              variant="outline"
              class="shrink-0 border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              title="停止生成"
            >
              <Square class="w-3.5 h-3.5" />
            </Button>
            <Button
              @click="handleSend"
              :disabled="!input.trim() || streaming"
              class="bg-amber-600 hover:bg-amber-500 disabled:opacity-50"
              title="发送"
            >
              <Send class="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <!-- 右侧世界书抽屉（移动端全宽限 320px，桌面 288px） -->
      <div
        class="shrink-0 border-l border-zinc-800/60 bg-zinc-950/90 backdrop-blur-md transition-all duration-300 overflow-hidden"
        :class="worldbookOpen ? 'w-full max-w-[320px] sm:w-72' : 'w-0'"
      >
        <div class="w-full max-w-[320px] sm:w-72 h-full flex flex-col">
          <div class="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60 shrink-0">
            <h2 class="text-sm font-semibold text-zinc-300 flex items-center gap-2">
              <BookOpen class="w-4 h-4 text-amber-500" />
              世界书
            </h2>
            <button @click="worldbookOpen = false" class="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors">
              <X class="w-3.5 h-3.5" />
            </button>
          </div>

          <div class="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            <!-- 静态世界书 -->
            <div v-if="script.worldbook.length > 0">
              <h3 class="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-2 px-1">
                静态设定 · {{ script.worldbook.length }} 条
              </h3>
              <div v-for="(entry, i) in script.worldbook" :key="'static-' + i" class="mb-2 px-2 py-1.5 rounded bg-zinc-900/60 border border-zinc-800/40 group">
                <div v-if="editingEntry?.source === 'static' && editingEntry?.index === i" class="space-y-1">
                  <input v-model="editEntryName" class="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="名称" />
                  <input v-model="editEntryType" class="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="类型" />
                  <input v-model="editEntryTriggers" class="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="激活词（逗号分隔）" />
                  <textarea v-model="editEntryContent" rows="2" class="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none" placeholder="内容" />
                  <div class="flex gap-1 pt-1">
                    <Button size="sm" class="text-[10px] h-6 px-2 bg-amber-600 hover:bg-amber-500" @click="saveStaticEntry(i)">保存</Button>
                    <Button size="sm" class="text-[10px] h-6 px-2 bg-zinc-700 hover:bg-zinc-600" @click="editingEntry = null">取消</Button>
                  </div>
                </div>
                <template v-else>
                  <div class="flex items-center gap-1.5">
                    <span class="inline-block w-1.5 h-1.5 rounded-full" :class="entry.active ? 'bg-green-500' : 'bg-zinc-600'" />
                    <span class="text-xs font-medium text-zinc-300 truncate">{{ entry.name }}</span>
                    <span class="text-[10px] ml-auto" :class="getTypeColor(entry.type)">{{ entry.type }}</span>
                    <button @click="startEditEntry(entry, 'static', i)" class="opacity-0 group-hover:opacity-100 p-0.5 rounded text-zinc-500 hover:text-zinc-300 transition-opacity" title="编辑">
                      <Pencil class="w-3 h-3" />
                    </button>
                    <button @click="deleteStaticEntry(i)" class="opacity-0 group-hover:opacity-100 p-0.5 rounded text-zinc-500 hover:text-red-400 transition-opacity" title="删除">
                      <Trash2 class="w-3 h-3" />
                    </button>
                  </div>
                  <div class="mt-1 text-[10px] text-zinc-500 truncate">激活词: {{ entry.triggers.join(', ') }}</div>
                  <div class="mt-0.5 text-[11px] text-zinc-400 line-clamp-6 relative">
                    {{ entry.content }}
                    <div class="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none absolute z-50 bottom-full left-0 mb-1.5 w-64 p-2.5 rounded-lg bg-zinc-800 border border-zinc-700 shadow-xl text-[11px] text-zinc-200 leading-relaxed whitespace-pre-wrap break-words">
                      <div class="font-medium text-zinc-100 mb-1">{{ entry.name }}</div>
                      <div class="text-zinc-400">{{ entry.content }}</div>
                      <div class="mt-1.5 text-[10px] text-zinc-500">激活词: {{ entry.triggers.join(', ') }}</div>
                    </div>
                  </div>
                </template>
              </div>
            </div>

            <!-- 动态世界书 L2 -->
            <div v-if="saveData.dynamicWorldbook.length > 0">
              <h3 class="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-2 px-1">
                动态剧情 · {{ saveData.dynamicWorldbook.length }} 条
              </h3>
              <div v-for="(entry, i) in saveData.dynamicWorldbook" :key="'dynamic-' + i" class="mb-2 px-2 py-1.5 rounded bg-zinc-900/60 border border-zinc-800/40 group">
                <div v-if="editingEntry?.source === 'dynamic' && editingEntry?.index === i" class="space-y-1">
                  <input v-model="editEntryName" class="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="名称" />
                  <input v-model="editEntryType" class="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="类型" />
                  <input v-model="editEntryTriggers" class="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="激活词（逗号分隔）" />
                  <textarea v-model="editEntryContent" rows="2" class="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none" placeholder="内容" />
                  <div class="flex gap-1 pt-1">
                    <Button size="sm" class="text-[10px] h-6 px-2 bg-amber-600 hover:bg-amber-500" @click="saveDynamicEntry(i)">保存</Button>
                    <Button size="sm" class="text-[10px] h-6 px-2 bg-zinc-700 hover:bg-zinc-600" @click="editingEntry = null">取消</Button>
                  </div>
                </div>
                <template v-else>
                  <div class="flex items-center gap-1.5">
                    <span class="inline-block w-1.5 h-1.5 rounded-full" :class="entry.active ? 'bg-amber-500' : 'bg-zinc-600'" />
                    <span class="text-xs font-medium text-zinc-300 truncate">{{ entry.name }}</span>
                    <span class="text-[10px] ml-auto" :class="getTypeColor(entry.type)">{{ entry.type }}</span>
                    <button @click="startEditEntry(entry, 'dynamic', i)" class="opacity-0 group-hover:opacity-100 p-0.5 rounded text-zinc-500 hover:text-zinc-300 transition-opacity" title="编辑">
                      <Pencil class="w-3 h-3" />
                    </button>
                    <button @click="deleteDynamicEntry(i)" class="opacity-0 group-hover:opacity-100 p-0.5 rounded text-zinc-500 hover:text-red-400 transition-opacity" title="删除">
                      <Trash2 class="w-3 h-3" />
                    </button>
                  </div>
                  <div class="mt-1 text-[10px] text-zinc-500 truncate">激活词: {{ entry.triggers.join(', ') }}</div>
                  <div class="mt-0.5 text-[11px] text-zinc-400 line-clamp-6 relative">
                    {{ entry.content }}
                    <div class="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none absolute z-50 bottom-full left-0 mb-1.5 w-64 p-2.5 rounded-lg bg-zinc-800 border border-zinc-700 shadow-xl text-[11px] text-zinc-200 leading-relaxed whitespace-pre-wrap break-words">
                      <div class="font-medium text-zinc-100 mb-1">{{ entry.name }}</div>
                      <div class="text-zinc-400">{{ entry.content }}</div>
                      <div class="mt-1.5 text-[10px] text-zinc-500">激活词: {{ entry.triggers.join(', ') }}</div>
                    </div>
                  </div>
                </template>
              </div>
            </div>

            <div v-if="script.worldbook.length === 0 && saveData.dynamicWorldbook.length === 0" class="text-center py-8 text-zinc-600 text-xs">
              暂无世界书词条
            </div>
          </div>

          <!-- 新增词条表单 -->
          <div class="border-t border-zinc-800/60 px-3 py-3 shrink-0">
            <button
              @click="newEntryOpen = !newEntryOpen"
              class="w-full flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-600 hover:text-zinc-400 font-semibold mb-2 transition-colors"
            >
              <ChevronDown v-if="newEntryOpen" class="w-3 h-3" />
              <ChevronRight v-else class="w-3 h-3" />
              <Plus class="w-3 h-3" />
              新增词条
            </button>
            <div v-if="newEntryOpen" class="space-y-1.5">
              <input v-model="newEntryName" placeholder="词条名称" class="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500 placeholder-zinc-600" />
              <input v-model="newEntryType" placeholder="类型（人物/事件/物品...）" class="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500 placeholder-zinc-600" />
              <input v-model="newEntryTriggers" placeholder="激活词（逗号分隔）" class="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500 placeholder-zinc-600" />
              <textarea v-model="newEntryContent" placeholder="词条内容（≤100 字）" rows="2" class="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500 placeholder-zinc-600 resize-none" />
              <Button
                size="sm"
                :disabled="!newEntryName.trim() || !newEntryContent.trim()"
                @click="addWorldbookEntry"
                class="w-full text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-50"
              >
                添加词条
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
