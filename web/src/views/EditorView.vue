<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { getScript, createScript, updateScript, deleteScript, listSaves, createSave } from '@/api'
import type { Script, WorldbookEntry } from '@/lib/types'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Tabs from '@/components/ui/Tabs.vue'
import GuidePreview from '@/components/GuidePreview.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { useToastStore } from '@/stores/toast'
import {
  ArrowLeft,
  Save,
  Eye,
  Trash2,
  Plus,
  X,
  FileText,
  ChevronDown,
  ChevronRight,
} from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const toast = useToastStore()
const isNew = route.query.id === 'new'

// 删除确认状态
const confirmClearWorldbook = ref(false)
const confirmDeleteOpen = ref(false)

const title = ref('')
const description = ref('')
const tags = ref<string[]>([])
const tagInput = ref('')
const coverUrl = ref('')
const prompt = ref('')
const worldbook = ref<WorldbookEntry[]>([])
const expandedWorldbookIndex = ref<number | null>(null)
const guide = ref('')
const activeTab = ref('prompt')
const saving = ref(false)
const loaded = ref(isNew)
const scriptId = ref<string | null>(null)
const coverInputRef = ref<HTMLInputElement | null>(null)

onMounted(() => {
  if (isNew) return
  const id = String(route.query.id ?? '')
  getScript(id)
    .then((script) => {
      title.value = script.meta.title
      description.value = script.meta.description
      tags.value = script.meta.tags
      coverUrl.value = script.meta.coverUrl ?? ''
      prompt.value = script.prompt
      worldbook.value = script.worldbook
      guide.value = script.guide ?? ''
      scriptId.value = id
      loaded.value = true
    })
    .catch((err) => {
      console.error('加载剧本失败:', err)
      loaded.value = true
    })
})

function addTag() {
  const t = tagInput.value.trim()
  if (t && !tags.value.includes(t)) {
    tags.value.push(t)
    tagInput.value = ''
  }
}

function removeTag(tag: string) {
  tags.value = tags.value.filter((t) => t !== tag)
}

function addWorldbookEntry() {
  worldbook.value.push({
    name: '',
    type: '人物',
    triggers: [],
    content: '',
    firstAppeared: 0,
    lastAppeared: 0,
    active: true,
  })
  expandedWorldbookIndex.value = worldbook.value.length - 1
}

function removeWorldbookEntry(index: number) {
  worldbook.value = worldbook.value.filter((_, i) => i !== index)
}

function updateWorldbookEntry(index: number, field: keyof WorldbookEntry, value: WorldbookEntry[typeof field]) {
  const updated = [...worldbook.value]
  updated[index] = { ...updated[index], [field]: value }
  worldbook.value = updated
}

function clearAllWorldbook() {
  worldbook.value = []
  confirmClearWorldbook.value = false
}

async function handleSave() {
  saving.value = true
  try {
    const scriptData: Script = {
      meta: {
        id: scriptId.value ?? '',
        title: title.value,
        description: description.value,
        coverUrl: coverUrl.value || undefined,
        tags: tags.value,
        createdAt: 0,
        updatedAt: 0,
        playCount: 0,
      },
      prompt: prompt.value,
      worldbook: worldbook.value,
      guide: guide.value || undefined,
    }
    if (isNew || !scriptId.value) {
      const res = await createScript(scriptData)
      scriptId.value = res.id
      router.replace(`/editor?id=${res.id}`)
    } else {
      await updateScript(scriptId.value, scriptData)
    }
  } catch (err) {
    console.error('保存失败:', err)
  } finally {
    saving.value = false
  }
}

/** 预览：无存档时自动创建新档并直接进入引导页，有存档则进入存档选择页 */
async function handlePreview() {
  if (!scriptId.value) return
  try {
    const saves = await listSaves(scriptId.value)
    if (saves.length === 0) {
      const sv = await createSave(scriptId.value)
      router.push(`/play/save?id=${scriptId.value}&save=${sv.id}`)
    } else {
      router.push(`/play?id=${scriptId.value}`)
    }
  } catch (err) {
    console.error('预览失败:', err)
    router.push(`/play?id=${scriptId.value}`)
  }
}

function handleDelete() {
  if (!scriptId.value) return
  confirmDeleteOpen.value = true
}

async function doDeleteScript() {
  if (!scriptId.value) return
  confirmDeleteOpen.value = false
  try {
    await deleteScript(scriptId.value)
    toast.success('剧本已删除')
    router.push('/')
  } catch (err) {
    toast.error('删除失败：' + (err instanceof Error ? err.message : String(err)))
  }
}

function handleCoverUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    toast.warning('请选择图片文件')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    coverUrl.value = typeof reader.result === 'string' ? reader.result : ''
  }
  reader.readAsDataURL(file)
  ;(e.target as HTMLInputElement).value = ''
}
</script>

<template>
  <div v-if="!loaded" class="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
    <p class="text-zinc-500">加载中...</p>
  </div>
  <div v-else class="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
    <!-- 顶栏（移动端：操作按钮仅图标，sm 起显示文字） -->
    <header class="border-b border-zinc-800 px-4 py-3 flex items-center justify-between shrink-0">
      <div class="flex items-center gap-3 min-w-0">
        <Button variant="ghost" size="icon" class="h-8 w-8 shrink-0" @click="router.push('/')">
          <ArrowLeft class="w-4 h-4" />
        </Button>
        <h1 class="text-base sm:text-lg font-semibold truncate">{{ isNew ? '新建剧本' : '编辑剧本' }}</h1>
      </div>
      <div class="flex items-center gap-1 sm:gap-2 shrink-0">
        <Button variant="outline" size="icon" class="h-8 w-8 sm:h-9 sm:w-auto sm:px-3 border-zinc-700" :disabled="!scriptId" @click="handlePreview" title="预览">
          <Eye class="w-4 h-4" />
          <span class="hidden sm:inline sm:ml-1">预览</span>
        </Button>
        <Button size="icon" class="h-8 w-8 sm:h-9 sm:w-auto sm:px-3 bg-amber-600 hover:bg-amber-500" :disabled="saving" @click="handleSave" title="保存">
          <Save class="w-4 h-4" />
          <span class="hidden sm:inline sm:ml-1">{{ saving ? '保存中...' : '保存' }}</span>
        </Button>
        <Button v-if="!isNew" variant="ghost" size="icon" class="h-8 w-8 sm:h-9 sm:w-auto sm:px-3 text-red-500 hover:text-red-400" @click="handleDelete" title="删除">
          <Trash2 class="w-4 h-4" />
          <span class="hidden sm:inline sm:ml-1">删除</span>
        </Button>
      </div>
    </header>

    <!-- 主体：左表单 + 右预览 -->
    <div class="flex flex-1 overflow-hidden flex-col lg:flex-row">
      <!-- 左侧表单 -->
      <div class="w-full lg:w-1/2 lg:border-r border-zinc-800 flex flex-col overflow-hidden">
        <div class="flex-1 overflow-y-auto">
          <div class="p-4 sm:p-6 space-y-5 sm:space-y-6">
            <!-- 基本信息 -->
            <section class="space-y-4">
              <h2 class="text-sm font-semibold text-zinc-400 uppercase tracking-wider">基本信息</h2>
              <div>
                <label class="text-sm text-zinc-400 mb-1 block">剧本标题</label>
                <Input :model-value="title" @update:model-value="title = $event" placeholder="输入剧本标题" class="bg-zinc-900 border-zinc-700" />
              </div>
              <div>
                <label class="text-sm text-zinc-400 mb-1 block">剧本简介</label>
                <textarea
                  :value="description"
                  @input="description = ($event.target as HTMLTextAreaElement).value"
                  placeholder="输入剧本简介（≤100 字）"
                  maxlength="100"
                  rows="3"
                  class="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
              <div>
                <label class="text-sm text-zinc-400 mb-1 block">标签</label>
                <div class="flex flex-wrap gap-2 mb-2">
                  <span v-for="tag in tags" :key="tag" class="inline-flex items-center gap-1 text-xs bg-zinc-800 text-zinc-300 px-2 py-1 rounded">
                    {{ tag }}
                    <button class="hover:text-red-400" @click="removeTag(tag)">
                      <X class="w-3 h-3" />
                    </button>
                  </span>
                </div>
                <div class="flex gap-2">
                  <Input
                    :model-value="tagInput"
                    @update:model-value="tagInput = $event"
                    placeholder="输入标签后回车"
                    class="bg-zinc-900 border-zinc-700 flex-1"
                    @keydown.enter.prevent="addTag"
                  />
                  <Button variant="outline" size="sm" class="border-zinc-700" @click="addTag">
                    <Plus class="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div>
                <label class="text-sm text-zinc-400 mb-1 block">封面图</label>
                <div v-if="coverUrl" class="flex items-start gap-3">
                  <div class="relative w-24 h-24 bg-zinc-800 rounded-lg overflow-hidden shrink-0">
                    <img :src="coverUrl" alt="封面预览" class="absolute inset-0 w-full h-full object-cover" />
                  </div>
                  <div class="flex flex-col gap-2">
                    <Button variant="outline" size="sm" class="border-zinc-700" @click="coverInputRef?.click()">
                      <Plus class="w-4 h-4 mr-1" />
                      更换图片
                    </Button>
                    <Button variant="outline" size="sm" class="border-zinc-700 text-red-500 hover:text-red-400" @click="coverUrl = ''">
                      <Trash2 class="w-4 h-4 mr-1" />
                      移除封面
                    </Button>
                  </div>
                </div>
                <Button v-else variant="outline" size="sm" class="border-zinc-700" @click="coverInputRef?.click()">
                  <Plus class="w-4 h-4 mr-1" />
                  上传封面图
                </Button>
                <input ref="coverInputRef" type="file" accept="image/*" class="hidden" @change="handleCoverUpload" />
              </div>
            </section>

            <!-- 分隔线 -->
            <div class="border-t border-zinc-800" />

            <!-- Tab 编辑区 -->
            <Tabs :model-value="activeTab" @update:model-value="activeTab = $event" :tabs="[
              { key: 'prompt', label: '📝 主提示词' },
              { key: 'worldbook', label: '📖 世界书' },
              { key: 'guide', label: '🎬 引导页' },
            ]" />

            <!-- Tab 1: 主提示词 -->
            <div v-if="activeTab === 'prompt'" class="space-y-2">
              <label class="text-sm text-zinc-400">此内容将作为 System Prompt 发送给 AI，定义世界观、角色行为规则、叙事风格等。</label>
              <textarea
                :value="prompt"
                @input="prompt = ($event.target as HTMLTextAreaElement).value"
                placeholder="# 世界观设定\n你是一位行走于江湖的侠客...\n\n## 角色人设\n- 姓名：\n- 性格：\n- 背景："
                rows="20"
                class="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            <!-- Tab 2: 世界书 -->
            <div v-else-if="activeTab === 'worldbook'" class="space-y-4">
              <div class="flex items-center justify-between">
                <span class="text-sm text-zinc-400">共 {{ worldbook.length }} 个词条</span>
                <div class="flex gap-2">
                  <Button variant="outline" size="sm" class="border-zinc-700" @click="addWorldbookEntry">
                    <Plus class="w-4 h-4 mr-1" />
                    新增词条
                  </Button>
                  <Button variant="outline" size="sm" class="border-zinc-700 text-red-500 hover:text-red-400" @click="confirmClearWorldbook = true">
                    <Trash2 class="w-4 h-4 mr-1" />
                    全部删除
                  </Button>
                </div>
              </div>

              <p v-if="worldbook.length === 0" class="text-zinc-600 text-sm py-8 text-center">暂无世界书词条，点击"新增词条"添加</p>
              <div v-for="(entry, index) in worldbook" :key="index" class="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                <button
                  type="button"
                  class="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-zinc-800/50 transition-colors"
                  @click="expandedWorldbookIndex = expandedWorldbookIndex === index ? null : index"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <ChevronDown v-if="expandedWorldbookIndex === index" class="w-4 h-4 text-zinc-500 shrink-0" />
                    <ChevronRight v-else class="w-4 h-4 text-zinc-500 shrink-0" />
                    <span class="text-sm font-medium truncate">{{ entry.name || `词条 ${index + 1}` }}</span>
                    <span v-if="entry.type" class="text-xs text-zinc-500 truncate">· {{ entry.type }}</span>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <span class="text-xs text-zinc-600 mr-1">{{ expandedWorldbookIndex === index ? '收缩' : '展开' }}</span>
                    <Button variant="ghost" size="icon" class="h-7 w-7 text-red-500 hover:text-red-400" @click.stop="removeWorldbookEntry(index)">
                      <Trash2 class="w-4 h-4" />
                    </Button>
                  </div>
                </button>

                <div v-if="expandedWorldbookIndex === index" class="px-4 pb-4 space-y-3 border-t border-zinc-800 pt-3">
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <label class="text-xs text-zinc-500 mb-1 block">词条名</label>
                      <Input :model-value="entry.name" @update:model-value="updateWorldbookEntry(index, 'name', $event)" placeholder="实体名称" class="bg-zinc-800 border-zinc-700 h-8 text-sm" />
                    </div>
                    <div>
                      <label class="text-xs text-zinc-500 mb-1 block">类型</label>
                      <Input :model-value="entry.type" @update:model-value="updateWorldbookEntry(index, 'type', $event)" placeholder="人物/事件/物品/任务/设定" class="bg-zinc-800 border-zinc-700 h-8 text-sm" />
                    </div>
                  </div>
                  <div>
                    <label class="text-xs text-zinc-500 mb-1 block">激活词（逗号分隔）</label>
                    <Input
                      :model-value="entry.triggers.join(', ')"
                      @update:model-value="updateWorldbookEntry(index, 'triggers', $event.split(/[,，]\s*/).filter(Boolean))"
                      placeholder="张三, 张兄, 三哥"
                      class="bg-zinc-800 border-zinc-700 h-8 text-sm"
                    />
                  </div>
                  <div>
                    <label class="text-xs text-zinc-500 mb-1 block">词条内容（≤100 字）</label>
                    <textarea
                      :value="entry.content"
                      @input="updateWorldbookEntry(index, 'content', ($event.target as HTMLTextAreaElement).value)"
                      maxlength="100"
                      rows="2"
                      placeholder="华山派大弟子，性格豪爽，善使长剑..."
                      class="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            <!-- Tab 3: 引导页 -->
            <div v-else class="space-y-2">
              <label class="text-sm text-zinc-400">HTML 角色创建页，新档/首次游玩时在 PLAY 页中渲染，玩家自定义初始信息。</label>
              <textarea
                :value="guide"
                @input="guide = ($event.target as HTMLTextAreaElement).value"
                placeholder='<div class="char-create">
  <h1>创建角色</h1>
  <label>姓名</label>
  <input type="text" id="name" />
  <label>门派</label>
  <select id="school">
    <option>华山派</option>
    <option>少林寺</option>
  </select>
  <button onclick="submit()">开始游戏</button>
</div>'
                rows="20"
                class="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧预览 -->
      <div class="w-full lg:w-1/2 bg-zinc-900/50 flex flex-col">
        <div class="border-b border-zinc-800 px-4 py-2">
          <span class="text-sm text-zinc-500">{{ activeTab === 'guide' ? '引导页预览' : '实时预览' }}</span>
        </div>
        <div v-if="activeTab === 'guide'" class="flex-1 p-6 min-h-0">
          <GuidePreview v-if="guide.trim()" :html="guide" />
          <div v-else class="h-full flex items-center justify-center">
            <p class="text-zinc-600 text-sm text-center">暂无引导页内容，在左侧输入 HTML 后实时预览</p>
          </div>
        </div>
        <div v-else class="flex-1 flex items-center justify-center p-8">
          <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-sm w-full">
            <div class="relative w-full h-32 bg-zinc-800 rounded-lg mb-4 flex items-center justify-center overflow-hidden">
              <img v-if="coverUrl" :src="coverUrl" alt="封面" class="absolute inset-0 w-full h-full object-cover" />
              <FileText v-else class="w-8 h-8 text-zinc-600" />
            </div>
            <h3 class="text-zinc-100 font-semibold text-lg mb-1">{{ title || '剧本标题' }}</h3>
            <p class="text-zinc-500 text-sm mb-3 line-clamp-2">{{ description || '剧本简介' }}</p>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="tag in tags" :key="tag" class="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">{{ tag }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 清空世界书确认 -->
  <ConfirmDialog
    :open="confirmClearWorldbook"
    title="清空世界书"
    message="确定删除全部世界书词条？此操作不可恢复。"
    confirm-text="清空"
    danger
    @update:open="confirmClearWorldbook = false"
    @confirm="clearAllWorldbook"
    @cancel="confirmClearWorldbook = false"
  />

  <!-- 删除剧本确认 -->
  <ConfirmDialog
    :open="confirmDeleteOpen"
    title="删除剧本"
    :message="`确定删除剧本「${title || '未命名'}」？此操作不可恢复，相关存档也会一并删除。`"
    confirm-text="删除"
    danger
    @update:open="confirmDeleteOpen = false"
    @confirm="doDeleteScript"
    @cancel="confirmDeleteOpen = false"
  />
</template>
