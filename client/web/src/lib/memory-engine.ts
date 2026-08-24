// L2 动态世界书引擎（移植自 src/lib/ai/memory-engine.ts，逻辑一致）

import type { SaveData, WorldbookEntry, Message } from '@/lib/types'
import type { ChatMessage } from '@/api/client'

/** L2 更新指令 */
export interface L2Update {
  name: string
  type: string
  triggers: string[]
  content: string
  action: 'create' | 'update'
}

/** L2 动态世界书配置 */
export const L2_CONFIG = {
  /** 动态世界书条目硬性上限 */
  MAX_ENTRIES: 2000,
  ACTIVITY_WINDOW: 20,
  PURGE_COUNT: 5,
  /** 单条记忆最大长度（字符），超过后由 AI 自动总结压缩 */
  MAX_CONTENT_LENGTH: 1000,
}

const L2_ENTRY_REGEX = /^\s*[-*]\s*(创建|更新)[：:]\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+)$/

/** 构建 L2 实体提取专用 prompt（独立后台任务）。
 * existingWorldbook 为当前动态世界书，让 AI 在"更新"时基于既有信息输出完整的合并描述，
 * 避免实体多次出现后旧信息丢失。 */
export function buildL2ExtractionPrompt(
  recentHistory: Message[],
  userInput: string,
  aiReply: string,
  existingWorldbook: WorldbookEntry[] = []
): ChatMessage[] {
  const historySummary = recentHistory
    .slice(-6)
    .map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${m.content.slice(0, 200)}`)
    .join('\n')

  // 当前已知实体上下文（供"更新"时整合既有信息）
  const knownEntities =
    existingWorldbook.length > 0
      ? existingWorldbook.map((e) => `- ${e.name}（${e.type}）：${e.content}`).join('\n')
      : '（暂无）'

  const systemPrompt =
    '你是一个实体提取助手。从以下对话中提取对后续剧情有重要价值的实体（人物、物品、地点、事件等）。\n' +
    '只提取重要的、可能影响后续剧情的实体，忽略无关紧要的细节。\n' +
    '只输出实体列表，不要输出任何其他内容。\n\n' +
    '格式要求：\n' +
    '📖 L2更新：\n' +
    '- 创建：实体名 | 类型 | 触发词1,触发词2 | 详细描述（100-1000字）\n' +
    '- 更新：实体名 | 类型 | 触发词1,触发词2 | 详细描述（100-1000字）\n\n' +
    '规则：\n' +
    '1. "创建"：首次出现的实体，描述完整\n' +
    '2. "更新"：已有实体出现新信息或变化。必须结合「当前已知实体」中的既有内容，' +
    '输出该实体**最新且完整**的描述（整合旧信息 + 新增信息，不可遗漏既有要点）\n' +
    '3. 触发词用逗号分隔，1-5个，至少包含实体名本身；已有实体沿用既有触发词并补充新触发词\n' +
    '4. 类型限：人物、物品、地点、事件、组织\n' +
    '5. 描述必须详细完整，包含外观、特征、背景、最新状态等\n' +
    '6. 每次提取不超过10个实体，只提取对后续剧情有价值的\n' +
    '7. 如果没有重要实体或变化，只输出 "📖 L2更新：" 空行'

  const userPrompt =
    '=== 当前已知实体 ===\n' +
    knownEntities +
    '\n\n=== 最近对话 ===\n' +
    historySummary +
    '\n\n=== 当前回合 ===\n' +
    `用户输入：${userInput.slice(0, 500)}\n` +
    `AI回复：${aiReply.slice(0, 1000)}\n\n` +
    '请提取本回合出现的实体：'

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]
}

/** 处理 L2 提取结果，更新 SaveData 动态世界书 */
export function processMemoryUpdate(l2RawText: string, saveData: SaveData): SaveData {
  const currentTurn = saveData.meta.turnCount
  const l2Updates = parseL2Updates(l2RawText)
  console.log('[MemoryEngine] L2 解析结果:', JSON.stringify(l2Updates))
  if (l2Updates.length > 0) {
    saveData.dynamicWorldbook = applyL2Updates(
      l2Updates,
      saveData.dynamicWorldbook,
      currentTurn
    )
  }
  return saveData
}

/** 从 AI 回复解析 L2 更新指令（符号标记格式 + JSON fallback） */
function parseL2Updates(aiReply: string): L2Update[] {
  const results: L2Update[] = []
  const lines = aiReply.split('\n')
  let inL2Section = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.includes('L2更新') || trimmed.includes('L2 更新') || trimmed.includes('动态世界书')) {
      inL2Section = true
      continue
    }
    if (!inL2Section) continue
    if (trimmed.startsWith('####') || trimmed.startsWith('###') || trimmed.startsWith('---')) {
      break
    }
    const match = trimmed.match(L2_ENTRY_REGEX)
    if (!match) continue
    const action = match[1] === '创建' ? 'create' as const : 'update' as const
    const name = match[2].trim()
    const type = match[3].trim()
    const triggersRaw = match[4].trim()
    const content = match[5].trim()
    if (!name) continue
    const triggers = triggersRaw
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean)
    results.push({
      name,
      type,
      triggers: triggers.length > 0 ? triggers : [name],
      content,
      action,
    })
  }

  if (results.length === 0) {
    const jsonResults = parseL2UpdatesJSON(aiReply)
    if (jsonResults.length > 0) return jsonResults
  }
  return results
}

/** 旧 JSON 格式解析（fallback） */
function parseL2UpdatesJSON(aiReply: string): L2Update[] {
  const L2_JSON_REGEX = /```json\s*({[\s\S]*?})\s*```/
  const jsonMatch = aiReply.match(L2_JSON_REGEX)
  if (!jsonMatch) return []
  try {
    const parsed = JSON.parse(jsonMatch[1])
    if (!parsed.l2_updates || !Array.isArray(parsed.l2_updates)) return []
    return parsed.l2_updates.map((item: Record<string, unknown>) => ({
      name: String(item.name ?? ''),
      type: String(item.type ?? ''),
      triggers: Array.isArray(item.triggers)
        ? item.triggers.map(String)
        : [String(item.name ?? '')],
      content: String(item.content ?? ''),
      action: item.action === 'create' ? 'create' : 'update',
    }))
  } catch {
    return []
  }
}

/**
 * 合并实体新旧描述。
 * - 一方为空 → 取另一方
 * - 新描述已包含旧描述（AI 输出了完整整合版）→ 直接用新描述，避免重复
 * - 否则（新描述是增量信息）→ 拼接保留（可能超长，由调用方触发 AI 总结压缩）
 */
function mergeContent(oldContent: string, newContent: string): string {
  const oldC = oldContent.trim()
  const newC = newContent.trim()
  if (!oldC) return newC
  if (!newC) return oldC
  if (newC.includes(oldC)) return newC
  if (oldC.includes(newC)) return oldC
  return `${oldC}\n${newC}`
}

/**
 * 构建超长记忆的 AI 总结 prompt。
 * 将超过 MAX_CONTENT_LENGTH 的实体记忆压缩为精简描述，保留关键信息。
 */
export function buildSummarizePrompt(entry: WorldbookEntry): ChatMessage[] {
  const systemPrompt =
    '你是一个记忆整理助手。将实体的详细记忆压缩总结为精简版本：' +
    '保留所有关键信息（身份、关系、经历、重要事件、当前状态），去除冗余修饰。' +
    '输出纯文本，不要任何格式标记或前缀。'
  const userPrompt =
    `实体名：${entry.name}\n` +
    `类型：${entry.type}\n\n` +
    `当前记忆内容：\n${entry.content}\n\n` +
    `请总结为不超过 ${L2_CONFIG.MAX_CONTENT_LENGTH} 字的精简描述：`
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]
}

/** 应用 L2 更新（上限/活跃度/淘汰策略） */
function applyL2Updates(
  updates: L2Update[],
  existing: WorldbookEntry[],
  currentTurn: number
): WorldbookEntry[] {
  let result = [...existing]

  for (const update of updates) {
    if (!update.name) continue
    const existingIdx = result.findIndex((e) => e.name === update.name)
    if (existingIdx >= 0) {
      const entry = result[existingIdx]
      result[existingIdx] = {
        ...entry,
        type: update.type || entry.type,
        triggers: update.triggers.length > 0 ? update.triggers : entry.triggers,
        // 智能合并：新描述与旧描述融合，避免实体多次出现后旧信息被覆盖丢失
        content: mergeContent(entry.content, update.content),
        lastAppeared: currentTurn,
        active: true,
      }
    } else {
      result.push({
        name: update.name,
        type: update.type,
        triggers: update.triggers.length > 0 ? update.triggers : [update.name],
        content: update.content,
        firstAppeared: currentTurn,
        lastAppeared: currentTurn,
        active: true,
      })
    }
  }

  const thresholdTurn = currentTurn - L2_CONFIG.ACTIVITY_WINDOW
  for (let i = 0; i < result.length; i++) {
    if (result[i].lastAppeared < thresholdTurn) {
      result[i] = { ...result[i], active: false }
    }
  }

  if (result.length > L2_CONFIG.MAX_ENTRIES) {
    const sorted = result.sort((a, b) => {
      if (a.active !== b.active) return a.active ? 1 : -1
      return a.lastAppeared - b.lastAppeared
    })
    result = sorted.slice(L2_CONFIG.PURGE_COUNT)
  }

  return result
}
