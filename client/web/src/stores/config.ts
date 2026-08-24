import { defineStore } from 'pinia'
import type { AIConfig, AppearanceConfig, CloudConfig } from '@/lib/types'
import {
  getAiSettings,
  saveAiSettings,
  getAppearanceSettings,
  saveAppearanceSettings,
  getCloudSettings,
  saveCloudSettings,
  getClientUid,
} from '@/api'

// 默认配置（与旧版 Zustand persist 默认值一致）
const DEFAULT_AI: AIConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-3.5-turbo',
  breakPrompt: '',
}

const DEFAULT_APPEARANCE: AppearanceConfig = {
  fontSize: 16,
  bubbleOpacity: 40,
  textColor: '#e4e4e7',
  headerOpacity: 80,
  bgDim: 40,
}

const DEFAULT_CLOUD: CloudConfig = {
  libraryBaseUrl: '',
}

/**
 * 全局配置 store（配置持久化在 Go 后端 SQLite，无需 persist 中间件）。
 * - aiConfig：AI 配置，修改即写回服务端
 * - appearance：外观配置，修改防抖 300ms 写回（避免 A⁺/A⁻ 高频请求）
 */
export const useConfigStore = defineStore('config', {
  state: () => ({
    aiConfig: { ...DEFAULT_AI },
    appearance: { ...DEFAULT_APPEARANCE },
    cloud: { ...DEFAULT_CLOUD },
    uid: '',
    loaded: false,
    _appearanceTimer: null as ReturnType<typeof setTimeout> | null,
  }),
  actions: {
    async loadConfig() {
      try {
        const [ai, appearance, cloud, uid] = await Promise.all([
          getAiSettings(),
          getAppearanceSettings(),
          getCloudSettings(),
          getClientUid(),
        ])
        this.aiConfig = { ...DEFAULT_AI, ...ai }
        this.appearance = { ...DEFAULT_APPEARANCE, ...appearance }
        this.cloud = { ...DEFAULT_CLOUD, ...cloud }
        this.uid = uid
      } catch (err) {
        console.error('加载配置失败', err)
      } finally {
        this.loaded = true
      }
    },
    async setAiConfig(patch: Partial<AIConfig>) {
      this.aiConfig = { ...this.aiConfig, ...patch }
      try {
        await saveAiSettings(patch)
      } catch (err) {
        console.error('保存 AI 配置失败', err)
      }
    },
    setAppearance(patch: Partial<AppearanceConfig>) {
      this.appearance = { ...this.appearance, ...patch }
      // 防抖写回完整外观配置
      if (this._appearanceTimer) clearTimeout(this._appearanceTimer)
      this._appearanceTimer = setTimeout(() => {
        saveAppearanceSettings({ ...this.appearance }).catch(() => {})
      }, 300)
    },
    async setCloudConfig(patch: Partial<CloudConfig>) {
      this.cloud = { ...this.cloud, ...patch }
      try {
        await saveCloudSettings(patch)
      } catch (err) {
        console.error('保存云端配置失败', err)
      }
    },
  },
})
