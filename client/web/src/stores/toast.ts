import { defineStore } from 'pinia'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastItem {
  id: number
  type: ToastType
  message: string
  duration: number
}

let nextId = 1

/**
 * 全局 Toast 提示（替换原生 alert，保持暗色主题一致）。
 * 用法：const toast = useToastStore(); toast.success('已保存'); toast.error('失败');
 */
export const useToastStore = defineStore('toast', {
  state: () => ({
    toasts: [] as ToastItem[],
  }),
  actions: {
    push(type: ToastType, message: string, duration?: number) {
      const id = nextId++
      const dur = duration ?? (type === 'error' ? 4000 : 2500)
      this.toasts.push({ id, type, message, duration: dur })
      if (dur > 0) setTimeout(() => this.remove(id), dur)
      return id
    },
    success(message: string, duration?: number) {
      return this.push('success', message, duration)
    },
    error(message: string, duration?: number) {
      return this.push('error', message, duration)
    },
    info(message: string, duration?: number) {
      return this.push('info', message, duration)
    },
    warning(message: string, duration?: number) {
      return this.push('warning', message, duration)
    },
    remove(id: number) {
      this.toasts = this.toasts.filter((t) => t.id !== id)
    },
  },
})
