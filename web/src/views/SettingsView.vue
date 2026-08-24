<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useConfigStore } from '@/stores/config'
import { exportBackup, importBackup, fetchModels as apiFetchModels } from '@/api'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import {
  ArrowLeft,
  Save,
  RefreshCw,
  Download,
  Upload,
  Check,
  AlertCircle,
  ChevronDown,
  Loader2,
  Droplets,
  Type,
  Globe,
} from 'lucide-vue-next'

/** 常见 API BaseURL 补全列表 */
const COMMON_BASE_URLS = [
  { label: 'OpenAI', url: 'https://api.openai.com/v1' },
  { label: 'DeepSeek', url: 'https://api.deepseek.com/v1' },
  { label: 'Ollama (本地)', url: 'http://localhost:11434/v1' },
  { label: 'Groq', url: 'https://api.groq.com/openai/v1' },
  { label: 'Together AI', url: 'https://api.together.xyz/v1' },
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
]

const DEFAULT_AI = { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-3.5-turbo', breakPrompt: '' }

const router = useRouter()
const config = useConfigStore()

const baseUrl = ref(config.aiConfig.baseUrl)
const apiKey = ref(config.aiConfig.apiKey)
const model = ref(config.aiConfig.model)
const breakPrompt = ref(config.aiConfig.breakPrompt || '')
const saved = ref(false)
const cloudBaseUrl = ref(config.cloud.libraryBaseUrl)
const cloudSaved = ref(false)

const models = ref<string[]>([])
const loadingModels = ref(false)
const modelsError = ref('')
const showUrlSuggestions = ref(false)

const backupStatus = ref<'idle' | 'exporting' | 'importing' | 'done' | 'error'>('idle')
const backupMessage = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)

// 启动时若配置尚未加载完成，同步一次本地表单
onMounted(() => {
  if (!config.loaded) {
    config.loadConfig().then(() => {
      baseUrl.value = config.aiConfig.baseUrl
      apiKey.value = config.aiConfig.apiKey
      model.value = config.aiConfig.model
      breakPrompt.value = config.aiConfig.breakPrompt || ''
      cloudBaseUrl.value = config.cloud.libraryBaseUrl
    })
  }
})

async function handleSaveCloud() {
  await config.setCloudConfig({ libraryBaseUrl: cloudBaseUrl.value.trim() })
  cloudSaved.value = true
  setTimeout(() => (cloudSaved.value = false), 2000)
}

/** 从 API 获取模型列表（经 Go 代理） */
async function fetchModels() {
  if (!apiKey.value) {
    modelsError.value = '请先填写 API Key'
    return
  }
  loadingModels.value = true
  modelsError.value = ''
  try {
    // 关键：先把当前输入的 BaseURL/API Key 同步到服务端，代理才用最新配置转发
    await config.setAiConfig({ baseUrl: baseUrl.value, apiKey: apiKey.value })
    const list = await apiFetchModels()
    if (list.length === 0) {
      modelsError.value = '未获取到模型列表'
      return
    }
    models.value = list
    model.value = list[0]
    // 自动选中第一个模型并保存
    await config.setAiConfig({ model: list[0] })
  } catch (err) {
    modelsError.value = '获取失败: ' + (err instanceof Error ? err.message : String(err))
    models.value = []
  } finally {
    loadingModels.value = false
  }
}

const filteredUrlSuggestions = computed(() =>
  COMMON_BASE_URLS.filter((item) => baseUrl.value && item.url.includes(baseUrl.value) && item.url !== baseUrl.value)
)

function selectUrlSuggestion(url: string) {
  baseUrl.value = url
  showUrlSuggestions.value = false
}

function onBlurUrl() {
  setTimeout(() => (showUrlSuggestions.value = false), 200)
}

function handleSave() {
  config.setAiConfig({ baseUrl: baseUrl.value, apiKey: apiKey.value, model: model.value, breakPrompt: breakPrompt.value })
  saved.value = true
  setTimeout(() => (saved.value = false), 2000)
}

function handleReset() {
  config.setAiConfig(DEFAULT_AI)
  baseUrl.value = DEFAULT_AI.baseUrl
  apiKey.value = DEFAULT_AI.apiKey
  model.value = DEFAULT_AI.model
  breakPrompt.value = DEFAULT_AI.breakPrompt
  models.value = []
  modelsError.value = ''
}

async function handleExport() {
  backupStatus.value = 'exporting'
  backupMessage.value = '正在打包数据...'
  try {
    await exportBackup()
    backupStatus.value = 'done'
    backupMessage.value = '备份导出成功！'
    setTimeout(() => (backupStatus.value = 'idle'), 3000)
  } catch (err) {
    backupStatus.value = 'error'
    backupMessage.value = '导出失败: ' + (err instanceof Error ? err.message : String(err))
  }
}

async function handleImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  backupStatus.value = 'importing'
  backupMessage.value = '正在导入数据...'
  try {
    await importBackup(file)
    backupStatus.value = 'done'
    backupMessage.value = '数据导入成功！请刷新页面查看。'
    setTimeout(() => (backupStatus.value = 'idle'), 5000)
  } catch (err) {
    backupStatus.value = 'error'
    backupMessage.value = '导入失败: ' + (err instanceof Error ? err.message : String(err))
  }
  if (fileInputRef.value) fileInputRef.value.value = ''
}
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100">
    <header class="border-b border-zinc-800 px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
      <Button variant="ghost" size="icon" class="h-9 w-9 sm:h-8 sm:w-8" @click="router.back()">
        <ArrowLeft class="w-4 h-4" />
      </Button>
      <h1 class="text-lg font-semibold">设置</h1>
    </header>

    <main class="max-w-xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8 sm:space-y-10">
      <!-- ===== AI 配置区块 ===== -->
      <section>
        <h2 class="text-base font-medium text-amber-500 mb-4">AI 配置</h2>
        <div class="space-y-4">
          <!-- BaseURL -->
          <div class="relative">
            <label class="text-sm text-zinc-400 mb-1 block">API BaseURL</label>
            <Input
              :model-value="baseUrl"
              @update:model-value="baseUrl = $event; showUrlSuggestions = true"
              placeholder="https://api.openai.com/v1"
              class="bg-zinc-900 border-zinc-700"
              @focus="showUrlSuggestions = true"
              @blur="onBlurUrl"
            />
            <div
              v-if="showUrlSuggestions && filteredUrlSuggestions.length > 0"
              class="absolute z-10 w-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden"
            >
              <button
                v-for="item in filteredUrlSuggestions"
                :key="item.url"
                @mousedown="selectUrlSuggestion(item.url)"
                class="w-full text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-2"
              >
                <span class="text-xs text-zinc-500 w-16 shrink-0">{{ item.label }}</span>
                <span class="font-mono text-xs truncate">{{ item.url }}</span>
              </button>
            </div>
            <p class="text-xs text-zinc-600 mt-1">支持 OpenAI 格式的 API 端点，如 DeepSeek、Ollama 等</p>
          </div>

          <!-- API Key -->
          <div>
            <label class="text-sm text-zinc-400 mb-1 block">API Key</label>
            <Input
              type="password"
              :model-value="apiKey"
              @update:model-value="apiKey = $event"
              placeholder="sk-..."
              class="bg-zinc-900 border-zinc-700"
            />
            <p class="text-xs text-zinc-600 mt-1">Key 存储在本地服务端数据库，AI 请求由后端代理转发</p>
          </div>

          <!-- 模型选择 + 获取列表按钮 -->
          <div>
            <label class="text-sm text-zinc-400 mb-1 block">模型</label>
            <div class="flex gap-2">
              <div class="relative flex-1">
                <select
                  :value="model"
                  @change="model = ($event.target as HTMLSelectElement).value"
                  class="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2.5 text-sm text-zinc-100 appearance-none focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
                  :disabled="loadingModels"
                  style="color-scheme: dark"
                >
                  <option v-if="models.length === 0" :value="model" class="bg-zinc-900 text-zinc-100">
                    {{ model || '点击右侧按钮获取模型列表' }}
                  </option>
                  <option v-for="m in models" :key="m" :value="m" class="bg-zinc-900 text-zinc-100">{{ m }}</option>
                </select>
                <ChevronDown class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
              </div>
              <Button
                @click="fetchModels"
                :disabled="loadingModels || !apiKey"
                variant="outline"
                class="border-zinc-700 shrink-0"
                title="获取模型列表"
              >
                <Loader2 v-if="loadingModels" class="w-4 h-4 animate-spin" />
                <RefreshCw v-else class="w-4 h-4" />
              </Button>
            </div>
            <p v-if="modelsError" class="text-xs text-red-400 mt-1">{{ modelsError }}</p>
            <p v-else-if="models.length > 0" class="text-xs text-green-400 mt-1">已获取 {{ models.length }} 个模型，默认选中第一个</p>
            <p class="text-xs text-zinc-600 mt-1">点击刷新按钮从 API 获取可用模型列表，或手动输入模型名称</p>
          </div>

          <!-- 破甲词 -->
          <div>
            <label class="text-sm text-zinc-400 mb-1 block">破甲词</label>
            <textarea
              :value="breakPrompt"
              @input="breakPrompt = ($event.target as HTMLTextAreaElement).value"
              placeholder="输入破甲词，将拼接在所有剧本提示词前..."
              rows="3"
              class="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500 placeholder-zinc-600 resize-none"
            />
            <p class="text-xs text-zinc-600 mt-1">破甲词将插入到每个剧本 System Prompt 的最前面，用于全局设定覆盖</p>
          </div>

          <div class="flex gap-3 pt-2">
            <Button @click="handleSave" class="bg-amber-600 hover:bg-amber-500 flex-1">
              <Save class="w-4 h-4 mr-2" />
              {{ saved ? '已保存' : '保存配置' }}
            </Button>
            <Button variant="outline" @click="handleReset" class="border-zinc-700">
              <RefreshCw class="w-4 h-4 mr-2" />
              重置
            </Button>
          </div>
        </div>
      </section>

      <!-- ===== 数据管理区块 ===== -->
      <section>
        <h2 class="text-base font-medium text-amber-500 mb-4">数据管理</h2>
        <p class="text-sm text-zinc-500 mb-4">导出所有剧本和存档为备份文件，或从备份文件恢复数据。</p>
        <div class="space-y-3">
          <Button
            @click="handleExport"
            :disabled="backupStatus === 'exporting' || backupStatus === 'importing'"
            variant="outline"
            class="border-zinc-700 w-full justify-start"
          >
            <Download class="w-4 h-4 mr-2" />
            导出全量备份 (.itb)
          </Button>

          <div>
            <input ref="fileInputRef" type="file" accept=".itb,.json" class="hidden" @change="handleImport" />
            <Button
              @click="fileInputRef?.click()"
              :disabled="backupStatus === 'exporting' || backupStatus === 'importing'"
              variant="outline"
              class="border-zinc-700 w-full justify-start"
            >
              <Upload class="w-4 h-4 mr-2" />
              导入备份文件
            </Button>
          </div>

          <div
            v-if="backupStatus !== 'idle'"
            :class="
              backupStatus === 'error'
                ? 'bg-red-900/30 text-red-400'
                : backupStatus === 'done'
                  ? 'bg-green-900/30 text-green-400'
                  : 'bg-zinc-800 text-zinc-300'
            "
            class="flex items-center gap-2 text-sm px-3 py-2 rounded"
          >
            <Check v-if="backupStatus === 'done'" class="w-4 h-4 shrink-0" />
            <AlertCircle v-else-if="backupStatus === 'error'" class="w-4 h-4 shrink-0" />
            <RefreshCw v-else class="w-4 h-4 shrink-0 animate-spin" />
            <span>{{ backupMessage }}</span>
          </div>
        </div>
      </section>

      <!-- ===== 公共剧本库区块 ===== -->
      <section>
        <h2 class="text-base font-medium text-amber-500 mb-4 flex items-center gap-2">
          <Globe class="w-4 h-4" />
          公共剧本库
        </h2>
        <div class="space-y-4">
          <div>
            <label class="text-sm text-zinc-400 mb-1 block">云端服务地址</label>
            <Input
              v-model="cloudBaseUrl"
              placeholder="http://localhost:8787"
              class="bg-zinc-900 border-zinc-700"
            />
            <p class="text-xs text-zinc-600 mt-1">
              公共剧本库云端服务地址。本地默认 http://localhost:8787，云部署后填线上域名。支持上传剧本、浏览共享、导入本地。
            </p>
          </div>
          <div class="flex gap-3">
            <Button @click="handleSaveCloud" class="bg-amber-600 hover:bg-amber-500 flex-1">
              <Save class="w-4 h-4 mr-2" />
              {{ cloudSaved ? '已保存' : '保存云端配置' }}
            </Button>
            <Button variant="outline" @click="router.push('/library')" class="border-zinc-700">
              <Globe class="w-4 h-4 mr-2" />
              打开公共剧本库
            </Button>
          </div>
        </div>
      </section>

      <!-- ===== 外观设置区块 ===== -->
      <section>
        <h2 class="text-base font-medium text-amber-500 mb-4">外观设置</h2>
        <div class="space-y-5">
          <div>
            <label class="text-sm text-zinc-400 mb-1.5 block flex items-center gap-2">
              <Droplets class="w-4 h-4" />
              气泡透明度
            </label>
            <div class="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                :value="config.appearance.bubbleOpacity"
                @input="config.setAppearance({ bubbleOpacity: Number(($event.target as HTMLInputElement).value) })"
                class="flex-1 h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-amber-500"
              />
              <span class="text-sm text-zinc-300 w-10 text-right font-mono">{{ config.appearance.bubbleOpacity }}%</span>
            </div>
            <div class="flex justify-between text-[10px] text-zinc-600 mt-0.5">
              <span>透明</span>
              <span>实心</span>
            </div>
          </div>

          <!-- 顶栏透明度 -->
          <div>
            <label class="text-sm text-zinc-400 mb-1.5 block flex items-center gap-2">
              <Droplets class="w-4 h-4" />
              顶栏透明度
            </label>
            <div class="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                :value="config.appearance.headerOpacity"
                @input="config.setAppearance({ headerOpacity: Number(($event.target as HTMLInputElement).value) })"
                class="flex-1 h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-amber-500"
              />
              <span class="text-sm text-zinc-300 w-10 text-right font-mono">{{ config.appearance.headerOpacity }}%</span>
            </div>
            <div class="flex justify-between text-[10px] text-zinc-600 mt-0.5">
              <span>全透明</span>
              <span>不透明</span>
            </div>
          </div>

          <!-- 背景图压暗 -->
          <div>
            <label class="text-sm text-zinc-400 mb-1.5 block flex items-center gap-2">
              <Droplets class="w-4 h-4" />
              背景图压暗
            </label>
            <div class="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="80"
                step="1"
                :value="config.appearance.bgDim"
                @input="config.setAppearance({ bgDim: Number(($event.target as HTMLInputElement).value) })"
                class="flex-1 h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-amber-500"
              />
              <span class="text-sm text-zinc-300 w-10 text-right font-mono">{{ config.appearance.bgDim }}%</span>
            </div>
            <div class="flex justify-between text-[10px] text-zinc-600 mt-0.5">
              <span>不压暗</span>
              <span>更暗</span>
            </div>
            <p class="text-xs text-zinc-600 mt-1">背景图较亮/文字看不清时可调高，配合文字描边保证清晰</p>
          </div>

          <!-- 消息字号 -->
          <div>
            <label class="text-sm text-zinc-400 mb-1.5 block flex items-center gap-2">
              <Type class="w-4 h-4" />
              消息字号
            </label>
            <div class="flex items-center gap-3">
              <input
                type="range"
                min="14"
                max="42"
                step="1"
                :value="config.appearance.fontSize"
                @input="config.setAppearance({ fontSize: Number(($event.target as HTMLInputElement).value) })"
                class="flex-1 h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-amber-500"
              />
              <span class="text-sm text-zinc-300 w-12 text-right font-mono">{{ config.appearance.fontSize }}px</span>
            </div>
            <div class="flex justify-between text-[10px] text-zinc-600 mt-0.5">
              <span>小</span>
              <span>大</span>
            </div>
            <p class="text-xs text-zinc-600 mt-1">对话页快捷栏的 A⁻/A⁺ 与此处同步</p>
          </div>

          <div class="pt-1">
            <Button
              variant="outline"
              @click="config.setAppearance({ fontSize: 16, bubbleOpacity: 40, textColor: '#e4e4e7', headerOpacity: 80, bgDim: 40 })"
              class="border-zinc-700 w-full justify-start"
            >
              <RefreshCw class="w-4 h-4 mr-2" />
              重置外观为默认值
            </Button>
          </div>
        </div>
      </section>

      <!-- ===== 关于 ===== -->
      <section>
        <h2 class="text-base font-medium text-amber-500 mb-4">关于</h2>
        <div class="text-sm text-zinc-500 space-y-1">
          <p>墨染酒馆 (Ink Tavern) v0.2.0</p>
          <p>轻量级 AI 角色扮演工具</p>
          <p>Go 后端 + Vue 前端，数据存储于本地 SQLite</p>
        </div>
      </section>
    </main>
  </div>
</template>
