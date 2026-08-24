<script setup lang="ts">
import { computed } from 'vue'

type ButtonVariant = 'default' | 'ghost' | 'outline' | 'destructive'
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon'

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant
    size?: ButtonSize
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
  }>(),
  {
    variant: 'default',
    size: 'default',
    type: 'button',
    disabled: false,
  }
)

const classes = computed(() => {
  const base =
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer focus-visible:outline-none'
  const variants: Record<ButtonVariant, string> = {
    default: 'bg-amber-600 text-white hover:bg-amber-500',
    ghost: 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-200',
    outline: 'text-zinc-300 border border-zinc-700 hover:bg-zinc-800',
    destructive: 'bg-red-600 text-white hover:bg-red-500',
  }
  const sizes: Record<ButtonSize, string> = {
    default: 'h-9 px-4',
    sm: 'h-8 px-3 text-xs',
    lg: 'h-10 px-6',
    icon: 'h-9 w-9',
  }
  return `${base} ${variants[props.variant]} ${sizes[props.size]}`
})
</script>

<template>
  <button :type="type" :class="classes" :disabled="disabled">
    <slot />
  </button>
</template>
