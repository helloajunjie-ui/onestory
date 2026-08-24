<script setup lang="ts">
// 编辑器右侧的引导页实时预览。
// 固定高度填满容器，内容在 iframe 内部滚动（纯预览场景，不显示提交/跳过交互栏）。
import { computed } from 'vue'
import { buildGuideHtml } from '@/lib/guide'

const props = defineProps<{ html: string }>()

const fullHtml = computed(() => buildGuideHtml(props.html, true))
</script>

<template>
  <div class="h-full bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
    <iframe
      title="guide-preview"
      sandbox="allow-scripts allow-same-origin"
      :srcdoc="fullHtml"
      class="w-full border-0 block"
      style="background: #18181b; height: 100%"
    />
  </div>
</template>
