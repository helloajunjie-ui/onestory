<script setup lang="ts">
// 引导页 iframe（移植自 src/components/guide-frame.tsx，改为固定高度框架）
// 内容超出时在 iframe 内部滚动，不再随内容无限增高。
// 通过 postMessage 双向通信：ink-tavern-ready / ink-tavern-submit
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { buildGuideHtml } from '@/lib/guide'
import { logger } from '@/lib/logger'

const props = defineProps<{ html: string }>()
const emit = defineEmits<{
  (e: 'submit', data: Record<string, string>): void
  (e: 'close'): void
}>()

const loaded = ref(false)
// preview 模式：html/body 高度 100%，body overflow-y auto，内容在框架内滚动
const fullHtml = computed(() => buildGuideHtml(props.html, true))

function handleMessage(event: MessageEvent) {
  if (!event.data || typeof event.data.type !== 'string') return
  switch (event.data.type) {
    case 'ink-tavern-ready':
      logger.debug('GuideFrame', '收到 ink-tavern-ready，iframe 已加载')
      loaded.value = true
      break
    case 'ink-tavern-submit':
      logger.info('GuideFrame', `收到 ink-tavern-submit，提交角色数据 keys=${Object.keys(event.data.data || {}).join(',')}`)
      emit('submit', event.data.data || {})
      break
  }
}

onMounted(() => {
  window.addEventListener('message', handleMessage)
})
onBeforeUnmount(() => {
  window.removeEventListener('message', handleMessage)
})
</script>

<template>
  <div
    class="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden flex flex-col"
    style="height: 60vh"
  >
    <iframe
      title="guide-frame"
      sandbox="allow-scripts allow-same-origin"
      :srcdoc="fullHtml"
      class="w-full flex-1 border-0 block"
      style="background: #18181b"
    />
    <div v-if="!loaded" class="px-4 py-3 text-sm text-zinc-500 shrink-0">加载引导页...</div>
    <div class="border-t border-zinc-800 px-4 py-2 flex items-center justify-between shrink-0">
      <p class="text-xs text-zinc-500">填写角色信息后点击按钮提交</p>
      <button @click="emit('close')" class="text-xs text-zinc-400 hover:text-zinc-200 underline">跳过引导</button>
    </div>
  </div>
</template>
