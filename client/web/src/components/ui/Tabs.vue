<script setup lang="ts">
// 最小 Tabs（触发器带 role="tab"/aria-selected，兼容 e2e 选择器）
export interface TabItem {
  key: string
  label: string
}

defineProps<{ modelValue: string; tabs: TabItem[] }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()
</script>

<template>
  <div class="flex gap-1 border-b border-zinc-800" role="tablist">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      role="tab"
      :aria-selected="modelValue === tab.key ? 'true' : 'false'"
      :class="
        modelValue === tab.key
          ? 'border-amber-500 text-amber-400'
          : 'border-transparent text-zinc-400 hover:text-zinc-200'
      "
      class="px-4 py-2 text-sm border-b-2 transition-colors"
      @click="emit('update:modelValue', tab.key)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>
