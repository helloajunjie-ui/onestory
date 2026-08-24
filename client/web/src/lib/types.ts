// 类型定义（与 Go 后端 store/models 及旧版 src/types 对齐）

export interface WorldbookEntry {
  name: string
  type: string
  triggers: string[]
  content: string
  firstAppeared: number
  lastAppeared: number
  active: boolean
}

export interface ScriptMeta {
  id: string
  title: string
  description: string
  coverUrl?: string
  tags: string[]
  createdAt: number
  updatedAt: number
  playCount: number
}

export interface Script {
  meta: ScriptMeta
  prompt: string
  worldbook: WorldbookEntry[]
  guide?: string
}

export type MessageRole = 'user' | 'assistant' | 'system'

export interface Message {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  turn: number
  edited: boolean
  regenerated: boolean
}

export interface Branch {
  id: string
  name: string
  forkTurn: number
  messages: Message[]
}

export interface SaveMeta {
  id: string
  scriptId: string
  name: string
  createdAt: number
  updatedAt: number
  turnCount: number
  summary: string
}

export interface SaveData {
  meta: SaveMeta
  history: Message[]
  state: Record<string, unknown>
  branches: Branch[]
  dynamicWorldbook: WorldbookEntry[]
}

export interface AIConfig {
  baseUrl: string
  apiKey: string
  model: string
  breakPrompt: string
}

export interface AppearanceConfig {
  fontSize: number
  bubbleOpacity: number
  textColor: string
  headerOpacity: number
  bgDim: number
}

/** 云端公共剧本库连接配置 */
export interface CloudConfig {
  libraryBaseUrl: string
}

/** 云端公共剧本库目录条目（云端 /api/scripts 列表返回） */
export interface LibraryItem {
  id: string
  title: string
  description: string
  coverUrl?: string
  tags: string[]
  author?: string
  createdAt: number
  downloadCount: number
}
