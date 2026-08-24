<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'

withDefaults(
  defineProps<{
    open: boolean
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    danger?: boolean
  }>(),
  {
    confirmText: '确认',
    cancelText: '取消',
    danger: false,
  }
)

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()
</script>

<template>
  <Dialog :open="open" @update:open="(v: boolean) => emit('update:open', v)">
    <div class="p-5">
      <h2 class="text-lg font-semibold mb-2" :class="danger ? 'text-red-400' : 'text-zinc-100'">{{ title }}</h2>
      <p class="text-sm text-zinc-400 leading-relaxed whitespace-pre-wrap">{{ message }}</p>
      <div class="flex justify-end gap-2 mt-5">
        <Button variant="ghost" size="sm" class="text-zinc-400" @click="emit('cancel')">{{ cancelText }}</Button>
        <Button
          size="sm"
          :class="danger ? 'bg-red-600 hover:bg-red-500' : 'bg-amber-600 hover:bg-amber-500'"
          @click="emit('confirm')"
        >
          {{ confirmText }}
        </Button>
      </div>
    </div>
  </Dialog>
</template>
