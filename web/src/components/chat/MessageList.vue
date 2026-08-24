<script setup lang="ts">
// 消息列表组件（移植自 src/components/chat/MessageList.tsx）
import { ref, watch, nextTick } from 'vue'
import type { Message, SaveData } from '@/lib/types'
import { renderMarkdown } from '@/lib/markdown'
import Button from '@/components/ui/Button.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { Copy, Pencil, RotateCcw, Trash2 } from 'lucide-vue-next'

const props = defineProps<{
  visibleMessages: Message[]
  saveData: SaveData
  streaming: boolean
  streamContent: string
  thinking: boolean
  currentPage: number
  totalPages: number
  editingMsgId: string | null
  editContent: string
  appearance: { fontSize: number; textColor: string }
}>()

const emit = defineEmits<{
  (e: 'editContentChange', v: string): void
  (e: 'editSave', msgId: string): void
  (e: 'editCancel'): void
  (e: 'startEdit', msgId: string, content: string): void
  (e: 'regenerate'): void
  (e: 'delete', msgId: string): void
  (e: 'copy', content: string): void
}>()

const isLatestPage = props.currentPage === props.totalPages - 1

function md(content: string) {
  return renderMarkdown(content)
}

// 重新生成 / 删除确认（用自研 ConfirmDialog 替代原生 confirm）
const confirmState = ref<null | { type: 'regenerate' | 'delete'; msgId?: string }>(null)

function onRegenerateClick() {
  confirmState.value = { type: 'regenerate' }
}

function onDeleteClick(msgId: string) {
  confirmState.value = { type: 'delete', msgId }
}

function confirmAction() {
  if (!confirmState.value) return
  const s = confirmState.value
  confirmState.value = null
  if (s.type === 'regenerate') emit('regenerate')
  else if (s.type === 'delete' && s.msgId) emit('delete', s.msgId)
}

// Vue 的 autofocus 属性在动态渲染时不生效，编辑态开启后聚焦编辑 textarea
watch(
  () => props.editingMsgId,
  async (id) => {
    if (id) {
      await nextTick()
      document.querySelector<HTMLTextAreaElement>('[data-edit-textarea]')?.focus()
    }
  }
)
</script>

<template>
  <div v-for="msg in visibleMessages" :key="msg.id" class="w-full">
    <div
      class="relative group w-full bg-zinc-900/[var(--bubble-bg-opacity)] backdrop-blur-md border border-zinc-800/50 shadow-sm rounded-2xl px-4 py-3 sm:px-6 sm:py-4"
      :class="msg.role === 'user' ? 'rounded-tr-sm' : 'rounded-tl-sm'"
    >
      <!-- 身份标识 Header -->
      <div class="text-xs mb-2 flex items-center gap-2" :class="msg.role === 'user' ? 'text-zinc-500' : 'text-amber-500/80'">
        <template v-if="msg.role === 'user'">👤 用户</template>
        <template v-else>✨ {{ saveData.meta.name || 'AI' }}</template>
      </div>

      <!-- 编辑模式 -->
      <div v-if="editingMsgId === msg.id" class="space-y-2">
        <textarea
          :value="editContent"
          @input="emit('editContentChange', ($event.target as HTMLTextAreaElement).value)"
          @keydown.ctrl.enter.prevent="emit('editSave', msg.id)"
          @keydown.meta.enter.prevent="emit('editSave', msg.id)"
          @keydown.esc="emit('editCancel')"
          data-edit-textarea
          class="w-full bg-black/40 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-y leading-relaxed"
          :rows="Math.max(3, editContent.split('\n').length)"
        />
        <div class="flex gap-2 justify-end">
          <Button variant="ghost" size="sm" class="text-xs text-zinc-400" @click="emit('editCancel')">取消</Button>
          <Button size="sm" class="text-xs bg-amber-600 hover:bg-amber-500" @click="emit('editSave', msg.id)">保存并重新生成</Button>
        </div>
      </div>

      <!-- Markdown 渲染消息内容 -->
      <div v-else class="prose prose-invert max-w-none prose-sm markdown-body" :style="{ fontSize: 'var(--app-font-size)', lineHeight: '1.75', color: appearance.textColor }" v-html="md(msg.content || '(空)')" />

      <!-- 底部信息栏 + 悬浮操作工具栏 -->
      <div class="flex items-center justify-between mt-3">
        <div class="flex items-center gap-2">
          <span v-if="msg.edited" class="text-[10px] text-zinc-500">已编辑</span>
          <span v-if="msg.regenerated" class="text-[10px] text-zinc-500">已重新生成</span>
        </div>
        <div class="flex items-center gap-1">
          <span class="text-[10px] text-zinc-500">
            {{ new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}
          </span>
          <!-- 复制 -->
          <button @click="emit('copy', msg.content)" class="p-1 hover:bg-zinc-700/50 rounded text-zinc-600 hover:text-zinc-400 transition-colors" title="复制">
            <Copy class="w-3 h-3" />
          </button>
          <template v-if="editingMsgId !== msg.id">
            <div class="flex items-center gap-0.5 ml-1">
              <button @click="emit('startEdit', msg.id, msg.content)" class="p-1.5 hover:bg-zinc-700/50 rounded text-zinc-500 hover:text-amber-400 transition-colors" title="编辑本条消息">
                <Pencil class="w-3.5 h-3.5" />
              </button>
              <button
                v-if="msg.role === 'assistant'"
                @click="onRegenerateClick"
                class="p-1.5 hover:bg-zinc-700/50 rounded text-zinc-500 hover:text-amber-400 transition-colors"
                title="重新生成 AI 回复"
              >
                <RotateCcw class="w-3.5 h-3.5" />
              </button>
              <button
                @click="onDeleteClick(msg.id)"
                class="p-1.5 hover:bg-zinc-700/50 rounded text-zinc-500 hover:text-red-400 transition-colors"
                title="删除（截断剧情）"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>

  <!-- 流式输出中的 AI 回复（仅最新页） -->
  <div v-if="streaming && streamContent && isLatestPage" class="w-full">
    <div class="w-full bg-zinc-900/[var(--bubble-bg-opacity)] backdrop-blur-md border border-zinc-800/50 shadow-sm rounded-2xl rounded-tl-sm px-4 py-3 sm:px-6 sm:py-4">
      <div class="text-xs text-amber-500/80 mb-2 flex items-center gap-2">✨ {{ saveData.meta.name || 'AI' }}</div>
      <div class="prose prose-invert max-w-none prose-sm markdown-body stream-caret" :style="{ fontSize: 'var(--app-font-size)', lineHeight: '1.75', color: appearance.textColor }" v-html="md(streamContent)" />
    </div>
  </div>

  <!-- "正在思考"占位符（仅最新页；推理模型在流式中也会进入思考状态） -->
  <div v-if="thinking && isLatestPage" class="w-full">
    <div class="w-full bg-zinc-900/[var(--bubble-bg-opacity)] backdrop-blur-md border border-zinc-800/50 shadow-sm rounded-2xl rounded-tl-sm px-4 py-3 sm:px-6 sm:py-4">
      <div class="text-xs text-amber-500/80 mb-2 flex items-center gap-2">✨ {{ saveData.meta.name || 'AI' }}</div>
      <div class="flex items-center" :style="{ fontSize: 'var(--app-font-size)', color: appearance.textColor }">
        <span class="thinking-dot w-1.5 h-1.5 rounded-full bg-amber-500/70" />
        <span class="thinking-dot w-1.5 h-1.5 rounded-full bg-amber-500/70 ml-1" style="animation-delay: 0.15s" />
        <span class="thinking-dot w-1.5 h-1.5 rounded-full bg-amber-500/70 ml-1" style="animation-delay: 0.3s" />
        <span class="ml-2">正在思考...</span>
      </div>
    </div>
  </div>

  <!-- 重新生成 / 删除确认 -->
  <ConfirmDialog
    :open="!!confirmState"
    :title="confirmState?.type === 'regenerate' ? '重新生成回复' : '删除剧情'"
    :message="
      confirmState?.type === 'regenerate'
        ? '重新生成将删除本条 AI 回复并重新请求，确定吗？'
        : '这将删除从本条消息开始之后的所有剧情，此操作不可恢复，确定吗？'
    "
    :confirm-text="confirmState?.type === 'regenerate' ? '重新生成' : '删除'"
    :danger="confirmState?.type === 'delete'"
    @update:open="confirmState = null"
    @confirm="confirmAction"
    @cancel="confirmState = null"
  />
</template>

<style scoped>
/* 流式输出：文字尾部闪烁光标（打字机效果） */
.stream-caret::after {
  content: '';
  display: inline-block;
  width: 2px;
  height: 1.1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: #f59e0b;
  border-radius: 1px;
  animation: caret-blink 0.9s step-start infinite;
}
@keyframes caret-blink {
  50% {
    opacity: 0;
  }
}

/* 思考态：三点阶梯跳动 */
.thinking-dot {
  animation: think-dot 1.2s ease-in-out infinite;
}
@keyframes think-dot {
  0%,
  60%,
  100% {
    opacity: 0.25;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-2px);
  }
}
</style>
