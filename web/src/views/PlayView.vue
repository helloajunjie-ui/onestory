<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { getScript, listSaves, createSave, deleteSave } from '@/api'
import type { Script, SaveMeta } from '@/lib/types'
import Button from '@/components/ui/Button.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { useToastStore } from '@/stores/toast'
import { ArrowLeft, Plus, Play, Trash2 } from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const scriptId = String(route.query.id ?? '')

const script = ref<Script | null>(null)
const saves = ref<SaveMeta[]>([])
const loading = ref(true)

async function loadData() {
  try {
    const [s, sv] = await Promise.all([getScript(scriptId), listSaves(scriptId)])
    return { s, sv }
  } catch (err) {
    console.error('加载失败:', err)
    return null
  }
}

async function handleNewSave() {
  try {
    const saveId = await createSave(scriptId)
    router.push(`/play/save?id=${scriptId}&save=${saveId.id}`)
  } catch (err) {
    console.error('创建存档失败:', err)
  }
}

const deletingSaveId = ref<string | null>(null)
const toast = useToastStore()

function handleDeleteSave(saveId: string) {
  deletingSaveId.value = saveId
}

async function doDeleteSave() {
  const saveId = deletingSaveId.value
  deletingSaveId.value = null
  if (!saveId) return
  try {
    await deleteSave(saveId)
    const result = await loadData()
    if (result) {
      script.value = result.s
      saves.value = result.sv
    }
    toast.success('存档已删除')
  } catch (err) {
    toast.error('删除存档失败：' + (err instanceof Error ? err.message : String(err)))
  }
}

onMounted(async () => {
  const result = await loadData()
  if (result) {
    script.value = result.s
    saves.value = result.sv
  }
  loading.value = false
})
</script>

<template>
  <div v-if="loading" class="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
    <p class="text-zinc-500">加载中...</p>
  </div>
  <div v-else-if="!script" class="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
    <div class="text-center">
      <p class="text-zinc-500 mb-4">剧本未找到</p>
      <Button variant="outline" @click="router.push('/')">返回首页</Button>
    </div>
  </div>
  <div v-else class="min-h-screen bg-zinc-950 text-zinc-100">
    <header class="border-b border-zinc-800 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <Button variant="ghost" size="icon" class="h-8 w-8" @click="router.push('/')">
          <ArrowLeft class="w-4 h-4" />
        </Button>
        <div>
          <h1 class="text-lg font-semibold">{{ script.meta.title }}</h1>
          <p class="text-sm text-zinc-500">选择存档</p>
        </div>
      </div>
      <Button class="bg-amber-600 hover:bg-amber-500" @click="handleNewSave">
        <Plus class="w-4 h-4 mr-2" />
        新开存档
      </Button>
    </header>

    <main class="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div v-if="saves.length === 0" class="text-center py-16">
        <p class="text-zinc-500 mb-4">暂无存档</p>
        <Button variant="outline" class="border-zinc-700" @click="handleNewSave">
          <Plus class="w-4 h-4 mr-2" />
          创建第一个存档
        </Button>
      </div>
      <div v-else class="space-y-3">
        <div
          v-for="save in saves"
          :key="save.id"
          class="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-center justify-between hover:border-zinc-700 transition-colors cursor-pointer"
          @click="router.push(`/play/save?id=${scriptId}&save=${save.id}`)"
        >
          <div>
            <h3 class="font-medium">{{ save.name }}</h3>
            <div class="flex gap-4 mt-1 text-sm text-zinc-500">
              <span>回合: {{ save.turnCount }}</span>
              <span>创建: {{ new Date(save.createdAt).toLocaleString('zh-CN') }}</span>
              <span>更新: {{ new Date(save.updatedAt).toLocaleString('zh-CN') }}</span>
            </div>
            <p v-if="save.summary" class="text-sm text-zinc-600 mt-1">{{ save.summary }}</p>
          </div>
          <div class="flex items-center gap-2">
            <Button variant="ghost" size="icon" class="h-8 w-8 text-emerald-500" @click.stop="router.push(`/play/save?id=${scriptId}&save=${save.id}`)">
              <Play class="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" class="h-8 w-8 text-red-500" @click.stop="handleDeleteSave(save.id)">
              <Trash2 class="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </main>

    <!-- 删除存档确认 -->
    <ConfirmDialog
      :open="!!deletingSaveId"
      title="删除存档"
      message="确定删除此存档？此操作不可恢复。"
      confirm-text="删除"
      danger
      @update:open="deletingSaveId = null"
      @confirm="doDeleteSave"
      @cancel="deletingSaveId = null"
    />
  </div>
</template>
