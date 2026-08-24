// Prompt 组装管线（移植自 src/lib/ai/prompt-builder.ts，逻辑一致）

import type { Script, SaveData, Message } from '@/lib/types'
import type { ChatMessage } from '@/api/client'
import { scanWorldbook, formatWorldbookHits } from './worldbook-scanner'
import { useConfigStore } from '@/stores/config'

export interface BuildPromptOptions {
  script: Script
  saveData: SaveData
  userInput: string
  history: Message[]
}

export function buildPrompt(options: BuildPromptOptions): ChatMessage[] {
  const { script, saveData, userInput, history } = options
  const messages: ChatMessage[] = []

  // ========== 1. System Prompt ==========
  const systemParts: string[] = []

  // 1a. 破甲词（全局配置，拼接在剧本提示词前）
  const { aiConfig } = useConfigStore()
  const breakPrompt = aiConfig.breakPrompt?.trim()
  const promptPrefix = breakPrompt ? breakPrompt + '\n\n' : ''
  // 1b. 剧本主提示词
  systemParts.push(promptPrefix + script.prompt)

  // 1c. 世界书触发（仅扫描当前 turn 用户输入，避免数据泄露）
  const { staticHits, dynamicHits } = scanWorldbook(
    userInput,
    script.worldbook,
    saveData.dynamicWorldbook
  )
  const worldbookText = formatWorldbookHits(staticHits, dynamicHits)
  if (worldbookText) {
    systemParts.push('\n\n' + worldbookText)
  }

  messages.push({ role: 'system', content: systemParts.join('\n\n') })

  // ========== 2. 对话历史（Token 裁剪） ==========
  const systemTokens = estimateTokens(systemParts.join('\n\n'))
  const maxTokens = 8192
  const trimmedHistory = trimHistory(history, maxTokens, systemTokens)

  for (const msg of trimmedHistory) {
    messages.push({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    })
  }

  // ========== 3. 当前用户输入 ==========
  messages.push({ role: 'user', content: userInput })

  return messages
}

/** 估算 Token（1 token ≈ 3.5 字符，保守策略） */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

/** 裁剪对话历史以适配 Token 限制（从最新消息开始保留） */
export function trimHistory(
  history: Message[],
  maxTokens: number,
  systemTokens: number
): Message[] {
  const userInputReserve = 500
  const availableTokens = maxTokens - systemTokens - userInputReserve

  if (availableTokens <= 0) return []

  let totalTokens = 0
  const result: Message[] = []

  for (let i = history.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(history[i].content)
    if (totalTokens + tokens > availableTokens) break
    totalTokens += tokens
    result.unshift(history[i])
  }

  return result
}
