<script setup lang="ts">
// 最小 Input（透传原生属性）
defineOptions({ inheritAttrs: false })
const props = defineProps<{
  modelValue?: string
  type?: string
  placeholder?: string
  maxlength?: number
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}
</script>

<template>
  <input
    :type="props.type || 'text'"
    :value="props.modelValue"
    :placeholder="props.placeholder"
    :maxlength="props.maxlength"
    @input="onInput"
    v-bind="$attrs"
    class="w-full h-9 px-3 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500 placeholder:text-zinc-500"
  />
</template>
