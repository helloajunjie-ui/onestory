// 世界书关键词扫描器（移植自 src/lib/ai/worldbook-scanner.ts，逻辑一致）

import type { WorldbookEntry } from '@/lib/types'

export interface ScanResult {
  staticHits: WorldbookEntry[]
  dynamicHits: WorldbookEntry[]
}

export function scanWorldbook(
  userInput: string,
  staticWorldbook: WorldbookEntry[],
  dynamicWorldbook: WorldbookEntry[],
  aiReply?: string
): ScanResult {
  const staticHits: WorldbookEntry[] = []
  const dynamicHits: WorldbookEntry[] = []
  const staticMatched = new Set<string>()
  const dynamicMatched = new Set<string>()

  // 合并搜索文本：用户输入 + AI 回复（若提供）
  const searchText = aiReply ? `${userInput}\n${aiReply}` : userInput

  for (const entry of staticWorldbook) {
    if (!entry.active) continue
    for (const trigger of entry.triggers) {
      if (!trigger) continue
      if (searchText.includes(trigger)) {
        if (!staticMatched.has(entry.name)) {
          staticMatched.add(entry.name)
          staticHits.push(entry)
        }
        break
      }
    }
  }

  for (const entry of dynamicWorldbook) {
    if (!entry.active) continue
    for (const trigger of entry.triggers) {
      if (!trigger) continue
      if (searchText.includes(trigger)) {
        if (!dynamicMatched.has(entry.name)) {
          dynamicMatched.add(entry.name)
          dynamicHits.push(entry)
        }
        break
      }
    }
  }

  return { staticHits, dynamicHits }
}

export function formatWorldbookHits(
  staticHits: WorldbookEntry[],
  dynamicHits: WorldbookEntry[]
): string {
  const parts: string[] = []

  if (staticHits.length > 0) {
    parts.push('## 📖 已激活的世界设定')
    parts.push(staticHits.map((w) => `- 【${w.name}】(${w.type}): ${w.content}`).join('\n'))
  }

  if (dynamicHits.length > 0) {
    parts.push('## 📖 已激活的剧情元素')
    parts.push(dynamicHits.map((w) => `- 【${w.name}】(${w.type}): ${w.content}`).join('\n'))
  }

  return parts.join('\n\n')
}
