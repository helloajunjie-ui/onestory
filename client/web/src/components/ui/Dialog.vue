<script setup lang="ts">
defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

function close() {
  emit('update:open', false)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/60" @click="close"></div>
      <div
        class="relative bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl w-full max-w-md text-zinc-100"
        role="dialog"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>
