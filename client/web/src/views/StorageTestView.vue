<script setup lang="ts">
// 存储自测页（移植自 src/app/storage-test/page.tsx）
import { ref, onMounted } from 'vue'
import { listScripts, createScript, deleteScript } from '@/api'
import { chatCompletion } from '@/api/stream'
import type { Script, ScriptMeta } from '@/lib/types'

function makeTestTitle() {
  return `测试剧本 ${Date.now().toString(36)}`
}

const scripts = ref<ScriptMeta[]>([])
const log = ref<string[]>([])
const loading = ref(true)
const l2Testing = ref(false)

function addLog(msg: string) {
  log.value.push(`[${new Date().toLocaleTimeString()}] ${msg}`)
}

async function loadScripts(): Promise<ScriptMeta[]> {
  return await listScripts()
}

async function handleCreate() {
  const testScript: Script = {
    meta: {
      id: '',
      title: makeTestTitle(),
      description: '这是一个持久化测试剧本',
      tags: ['测试'],
      createdAt: 0,
      updatedAt: 0,
      playCount: 0,
    },
    prompt: '# 测试世界观\n\n这是一个测试用的 prompt。',
    worldbook: [
      {
        name: '测试角色',
        type: '人物',
        triggers: ['测试角色', 'test'],
        content: '这是一个测试角色',
        firstAppeared: 0,
        lastAppeared: 0,
        active: true,
      },
    ],
    guide: '<h1>创建角色</h1><p>测试引导页</p>',
  }
  try {
    const res = await createScript(testScript)
    addLog(`创建剧本成功: id=${res.id}`)
  } catch (err) {
    addLog(`❌ 创建失败: ${err instanceof Error ? err.message : String(err)}`)
  }
  const list = await loadScripts()
  scripts.value = list
  addLog(`已加载 ${list.length} 个剧本`)
}

async function handleDelete(id: string) {
  try {
    await deleteScript(id)
    addLog(`删除剧本: ${id}`)
  } catch (err) {
    addLog(`❌ 删除失败: ${err instanceof Error ? err.message : String(err)}`)
  }
  const list = await loadScripts()
  scripts.value = list
  addLog(`已加载 ${list.length} 个剧本`)
}

/** L2 实体提取测试 */
async function handleTestL2() {
  l2Testing.value = true
  addLog('--- L2 测试开始 ---')

  const testPrompt = `你是一个实体提取助手。请阅读以下剧情片段，然后提取其中出现的实体。

## 剧情片段
林月是江南水乡的绣坊女，今日她正在绣一幅并蒂莲花图。窗外传来喧哗声，她抬头望去，只见一队官兵簇拥着一位锦衣公子经过。那公子骑着一匹白马，腰间佩着一柄青锋剑，剑鞘上镶着宝石。林月认出那是知府家的公子沈玉堂。

## 指令
请在回复末尾提取本段中出现的实体，格式如下：

📖 L2更新：
- 创建：实体名 | 类型 | 触发词1,触发词2 | 描述
- 创建：实体名 | 类型 | 触发词1,触发词2 | 描述

只输出实体行，不要额外说明。`

  try {
    addLog('发送测试请求...')
    const reply = await chatCompletion([{ role: 'user', content: testPrompt }])
    addLog(`AI 回复长度: ${reply.length} 字符`)
    addLog('--- AI 回复全文 ---')
    addLog(reply)
    addLog('--- 回复末尾 300 字符 ---')
    addLog(reply.slice(-300))

    const hasL2Marker = reply.includes('L2更新') || reply.includes('L2 更新')
    addLog(`包含 📖 L2更新 标记: ${hasL2Marker}`)

    const L2_ENTRY_REGEX = /^\s*[-*]\s*(创建|更新)[：:]\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+)$/
    const lines = reply.split('\n')
    let matchCount = 0
    for (const line of lines) {
      const match = line.trim().match(L2_ENTRY_REGEX)
      if (match) {
        matchCount++
        addLog(`  实体行 #${matchCount}: ${match[0].trim()}`)
      }
    }
    addLog(`匹配到实体行数: ${matchCount}`)
    if (matchCount === 0) {
      addLog('⚠️ 未匹配到任何实体行！AI 没有按格式输出 L2')
    } else {
      addLog('✅ L2 格式正确')
    }
  } catch (err) {
    addLog(`❌ 请求失败: ${err instanceof Error ? err.message : String(err)}`)
  }

  addLog('--- L2 测试结束 ---')
  l2Testing.value = false
}

onMounted(async () => {
  const list = await loadScripts()
  scripts.value = list
  addLog(`已加载 ${list.length} 个剧本`)
  loading.value = false
})
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100 p-8">
    <h1 class="text-2xl font-bold mb-6">🧪 存储适配器测试</h1>

    <div class="flex gap-3 mb-6">
      <button @click="handleCreate" class="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-md">➕ 新建测试剧本</button>
      <button @click="handleTestL2" :disabled="l2Testing" class="bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800 text-white px-4 py-2 rounded-md">
        {{ l2Testing ? '⏳ 测试中...' : '🧪 测试 L2 实体提取' }}
      </button>
    </div>

    <div class="grid gap-4 mb-8">
      <p v-if="loading" class="text-zinc-500">加载中...</p>
      <p v-else-if="scripts.length === 0" class="text-zinc-500">暂无剧本，点击上方按钮创建</p>
      <div v-for="s in scripts" :key="s.id" class="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-center justify-between">
        <div>
          <h3 class="font-semibold">{{ s.title }}</h3>
          <p class="text-sm text-zinc-400">{{ s.description }}</p>
          <div class="flex gap-2 mt-1">
            <span v-for="t in s.tags" :key="t" class="text-xs bg-zinc-800 px-2 py-0.5 rounded">{{ t }}</span>
          </div>
          <p class="text-xs text-zinc-600 mt-1">ID: {{ s.id }} | 创建: {{ new Date(s.createdAt).toLocaleString() }}</p>
        </div>
        <button @click="handleDelete(s.id)" class="text-red-400 hover:text-red-300 text-sm">删除</button>
      </div>
    </div>

    <div class="border-t border-zinc-800 pt-4">
      <h2 class="text-lg font-semibold mb-2">操作日志</h2>
      <div class="bg-zinc-900 rounded-lg p-4 h-48 overflow-y-auto font-mono text-sm space-y-1">
        <div v-for="(msg, i) in log" :key="i" class="text-zinc-400">{{ msg }}</div>
      </div>
    </div>
  </div>
</template>
