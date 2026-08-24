<script setup lang="ts">
import { useToastStore, type ToastType } from '@/stores/toast'
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-vue-next'

const store = useToastStore()

const icons: Record<ToastType, unknown> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
}
const colors: Record<ToastType, string> = {
  success: 'border-emerald-500/40',
  error: 'border-red-500/40',
  info: 'border-sky-500/40',
  warning: 'border-amber-500/40',
}
const iconColors: Record<ToastType, string> = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  info: 'text-sky-400',
  warning: 'text-amber-400',
}
</script>

<template>
  <div class="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-80 pointer-events-none">
    <TransitionGroup name="toast">
      <div
        v-for="t in store.toasts"
        :key="t.id"
        class="pointer-events-auto flex items-start gap-2.5 bg-zinc-900/95 backdrop-blur border rounded-lg shadow-xl px-3.5 py-2.5 text-sm"
        :class="colors[t.type]"
      >
        <component :is="icons[t.type]" class="w-4 h-4 mt-0.5 shrink-0" :class="iconColors[t.type]" />
        <span class="flex-1 text-zinc-200 break-words leading-relaxed">{{ t.message }}</span>
        <button
          @click="store.remove(t.id)"
          class="shrink-0 p-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          <X class="w-3 h-3" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(16px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(16px);
}
</style>
