// 剧本导入工具：任意格式的剧本 JSON → AI 分析提取 → 映射到标准 Script
import { chatCompletion } from '@/api/stream'
import type { Script, WorldbookEntry } from '@/lib/types'

/** 检测是否为墨染酒馆 .ink.json 格式（自家格式，无需 AI，直接解析） */
export function isInkTavernJSON(text: string): boolean {
  try {
    const d = JSON.parse(text)
    return d?.type === 'ink-tavern-script' && !!d?.data
  } catch {
    return false
  }
}

/** 从 .ink.json 直接提取 Script（不走 AI） */
export function parseInkTavernJSON(text: string): Script | null {
  try {
    const d = JSON.parse(text)
    if (d?.type !== 'ink-tavern-script' || !d?.data) return null
    const s = d.data
    return {
      meta: {
        id: '',
        title: String(s.meta?.title || ''),
        description: String(s.meta?.description || ''),
        coverUrl: s.meta?.coverUrl || undefined,
        tags: Array.isArray(s.meta?.tags) ? s.meta.tags.map(String) : [],
        createdAt: 0,
        updatedAt: 0,
        playCount: 0,
      },
      prompt: String(s.prompt || ''),
      worldbook: Array.isArray(s.worldbook) ? s.worldbook : [],
      guide: s.guide || undefined,
    }
  } catch {
    return null
  }
}

/** 安全解析 JSON */
function safeParse(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}


/**
 * 从可能含 HTML/CSS 的源文本中提取干净简介。
 * 优先用 DOMParser 提取可见文本（精准剔除 style/script/标签），解析失败时正则兜底。
 */
function cleanDescription(text: unknown): string {
  let s = String(text ?? '')
  // 含 HTML 时优先用 DOMParser 提取可见文本
  if (typeof document !== 'undefined' && /<[a-z]/i.test(s)) {
    try {
      const doc = new DOMParser().parseFromString(s, 'text/html')
      doc.querySelectorAll('style, script, head, meta, link, title, noscript, svg').forEach((el) => el.remove())
      const plain = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim()
      if (plain) s = plain
    } catch {
      /* 走下方正则兜底 */
    }
  }
  // 正则兜底：去 style/script/head 块与标签
  if (/<[a-z]/i.test(s)) {
    s = s
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<head[\s\S]*?<\/head>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  }
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > 300 ? s.slice(0, 300) : s
}

/**
 * 启发式提取常见剧本字段（兼容不同平台命名）。
 * 只提取能直接读到的关键字段并完整保留，大幅缩小喂给 AI 的内容；
 * 格式完全不认识（提取不到关键字段）时返回 null，调用方回退到原始 JSON。
 */
function extractKnownFields(obj: Record<string, unknown>): Record<string, unknown> | null {
  const get = (...keys: string[]): unknown => {
    for (const k of keys) {
      const v = obj[k]
      if (v !== undefined && v !== null && v !== '') return v
    }
    return undefined
  }
  const title = get('name', 'title', 'script_name', 'scriptName', '剧本名')
  const description = get('description', 'intro', 'summary', '简介')
  const prompt = get('pre_prompt', 'prePrompt', 'prompt', 'system_prompt', 'systemPrompt', 'main_prompt', 'mainPrompt')
  const worldbook = get('world_book', 'worldbook', 'worldBook', 'world_info', 'worldInfo', 'definitions', 'characters')
  const guide = get('guide', 'guide_html', 'guideHtml', 'role_play_page', 'rolePlayPage', '引导页')
  const opening = get('opening_statement', 'openingStatement', 'opening', '开场白')
  const cover = get('cover', 'coverUrl', 'cover_url', 'coverImage', '封面')
  const tags = get('tags', 'categories', 'labels')

  // 至少提取到标题/提示词/世界书之一，才算识别成功
  if (!title && !prompt && !worldbook && !description && !guide) return null

  const result: Record<string, unknown> = {}
  if (title) result.title = title
  if (description) result.description = cleanDescription(description)
  if (prompt) result.prompt = prompt
  if (worldbook) result.worldbook = worldbook
  if (guide) result.guide = guide
  if (opening) result.opening = opening
  if (cover) result.cover = cover
  if (tags) result.tags = tags
  return result
}

/**
 * 构建 AI 剧本解析 prompt。
 * - 优先启发式提取关键字段（标题/提示词/世界书/引导页等），只把精简内容喂给 AI，大文件也能完整处理
 * - 格式完全不认识时回退到原始 JSON（截断到 10 万字符）
 */
export function buildImportPrompt(jsonText: string): { role: 'system' | 'user'; content: string }[] {
  const parsed = safeParse(jsonText)
  const known = parsed && typeof parsed === 'object' ? extractKnownFields(parsed as Record<string, unknown>) : null
  const input = known
    ? JSON.stringify(known, null, 1)
    : jsonText.length > 100000
      ? jsonText.slice(0, 100000) + '\n...(内容较长已截断，请基于可见部分提取)'
      : jsonText

  const system =
    '你是一个剧本格式转换助手。用户会提供一个 AI 角色扮演剧本的数据（来自不同平台，结构差异大）。' +
    '请识别其平台结构并转换为标准格式。\n\n' +
    '常见平台结构特征：\n' +
    '- 风月：扁平，name + pre_prompt + post_text + world_book + opening_statement + cover + bg_image\n' +
    '- 春潮：字段在 work 子对象内（work.title/work.mainPrompt/work.worldviewDefinition），detailIntro 可能含 HTML\n' +
    '- MISS：提示词在 promptData 子对象（systemPrompt/prePrompt/breakArmorWord/postPrompt），关键词为数组，description 可能含 HTML\n' +
    '- 日礼：扁平，title + description(可能 null) + prompt + cover + background，introPage 含 HTML\n' +
    '- 春水：字段在 braindance 子对象（systemPrompt/jailbreakPrompt/prePrompt/postPrompt），description 可能含 HTML\n' +
    '- 酒馆/SillyTavern：spec/data 或 character 包裹，世界书在 data.character_book.entries，firstMes 为开场白\n\n' +
    '目标格式（只输出 JSON，不要任何其他文字、不要 markdown 代码块）：\n' +
    '{\n' +
    '  "title": "剧本标题",\n' +
    '  "description": "简介，纯文本，不超过100字",\n' +
    '  "tags": ["标签1", "标签2"],\n' +
    '  "coverUrl": "封面图片URL，没有则留空字符串",\n' +
    '  "prompt": "主提示词，按固定顺序拼接：①前置（破甲词若有放最前，然后 AI设定→世界观→人物设定→游戏规则等）②核心提示词（角色行为、叙事要求）③后置（文风/写作风格/输出要求）。输出完整拼接文本",\n' +
    '  "worldbook": [{"name":"词条名","type":"人物/物品/地点/事件/组织/设定","triggers":["触发词1","触发词2"],"content":"词条内容"}],\n' +
    '  "guide": "引导页/角色创建页的 HTML（如果有；没有则为空字符串）"\n' +
    '}\n\n' +
    '提取规则：\n' +
    '1. 根据上述平台结构，从数据中找出标题、简介、标签、封面、主提示词、世界书词条、引导页/开场白。\n' +
    '2. 提示词可能拆分为 破甲词/前置词/主提示词/后置词/文风，按固定顺序整合为完整 prompt：\n' +
    '   前置（破甲词→AI设定→世界观→人物设定→游戏规则等）→ 核心提示词 → 后置（文风/输出要求）。\n' +
    '3. 世界书/设定词条：每项可能是 {key或keywords, value或content, group, enabled,...} 等结构，' +
    '提取 name（词条名，可用 key/name/名称）、type（按内容推断）、triggers（关键词，至少含词条名）、content（内容）。\n' +
    '4. description 可能是 HTML（宣发页/介绍），提取为纯文本简介。\n' +
    '5. guide：数据中有引导页（guide/guide_html/引导页）则提取；若只有开场白（opening_statement/firstMes/openings），' +
    '将其构造为引导页 HTML；都没有则留空字符串。\n' +
    '6. 只输出 JSON，不要解释。'

  const user = `以下是剧本数据：\n${input}\n\n请转换为标准格式：`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** 从 AI 回复中提取 JSON 对象 */
export function extractJSON(text: string): unknown | null {
  // 兼容 ```json 代码块包裹
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

// ==================== 规则映射解析（不依赖 AI） ====================
// 参考 UIF 通用中间格式方法：识别平台 → 按语义映射提取字段，秒级完成。
// 世界书等大内容逐条转换（分批录入），避免一次性处理大内容失败。

/** 在对象中按 key 顺序取第一个非空值 */
function flexGet(obj: Record<string, unknown> | undefined, ...keys: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined
  for (const k of keys) {
    const v = obj[k]
    if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) return v
  }
  return undefined
}

function str(v: unknown): string {
  if (v === undefined || v === null) return ''
  return String(v)
}

/** 识别剧本平台格式（参考 UIF detectFormat） */
export function detectFormat(obj: Record<string, unknown>): string | null {
  if (!obj || typeof obj !== 'object') return null
  if (obj.work && typeof obj.work === 'object') return 'chunchao'
  if (obj.braindance && typeof obj.braindance === 'object') return 'chunshui'
  if (obj.promptData && typeof obj.promptData === 'object') return 'miss'
  if (obj.spec || obj.data || obj.character) return 'sillytavern'
  if (obj.name && (obj.pre_prompt || obj.world_book)) return 'fengyue'
  if (obj.title && (obj.prompt || obj.description)) return 'rili'
  return null
}

/** 标签归一化（支持字符串数组 / 对象数组 {name} / 数字 ID→tag:N） */
function tagsFrom(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((t) => {
      if (typeof t === 'string') return t
      if (typeof t === 'number') return `tag:${t}`
      if (t && typeof t === 'object') return str((t as Record<string, unknown>).name || (t as Record<string, unknown>).label)
      return String(t)
    })
    .filter(Boolean)
}

/** 提取有意义的第一行（用于无 summary 的平台，如日礼从 description 取首行简介） */
function firstMeaningfulLine(s: string): string {
  const clean = s.trim()
  if (!clean) return ''
  const line = clean.split('\n')[0].trim()
  return line.length > 200 ? line.slice(0, 200) : line
}

/**
 * 解析世界书关键词（对齐成熟转换工具）：
 * - 数组：直接取字符串元素
 * - 字符串：拆 `@wb@` 分隔，去掉 `_or_`/`_and_` 组合标记（`_or_苏晚禾@wb@大妻` → ['苏晚禾','大妻']）
 * - 对象（酒馆 V2 keys:{keywords:[...]}）：取内部 keywords/key/keys 数组
 */
function parseKeywords(raw: unknown): string[] {
  // 对象格式：酒馆 V2 的 keys 是 {keywords:[...]}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    raw = (raw as Record<string, unknown>).keywords || (raw as Record<string, unknown>).key || (raw as Record<string, unknown>).keys
  }
  let parts: string[] = []
  if (Array.isArray(raw)) parts = raw.map(String)
  else if (typeof raw === 'string') parts = [raw]
  const out: string[] = []
  for (const p of parts) {
    out.push(
      ...p
        .split(/_(?:or|and)_|@wb@/i)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  }
  return out
}

/** 从内容中提取触发关键词（如春水格式"触发关键词：A、B、C"） */
function extractTriggersFromContent(content: string): string[] {
  const m = content.match(/触发关键词?[:：]\s*([^\n]+)/)
  if (m) {
    return m[1]
      .split(/[,，、；;]/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return []
}

/**
 * 世界书词条转换（对齐成熟转换工具：词条名即第一个激活词，激活词完整拆分）。
 * 世界书条目通常没有独立词条名，标题即激活词；若内容开头有明确的"词条N：XXX·…"且比激活词更清晰，
 * 则优先用内容中的词条名。
 */
function worldbookFrom(wb: unknown): WorldbookEntry[] {
  if (!Array.isArray(wb)) return []
  const list: WorldbookEntry[] = []
  for (const item of wb) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    const content = str(it.value || it.content || it.definition || it.desc)
    if (!content) continue
    // 激活词：优先字段关键词，字段缺失时从内容中"触发关键词"提取
    let triggers = parseKeywords(flexGet(it, 'keys', 'key', 'keywords', 'keyword', 'trigger', 'triggers'))
    if (triggers.length === 0) triggers = extractTriggersFromContent(content)
    // 词条名：优先专用字段，否则用第一个激活词（对齐成熟转换工具：词条无独立名，标题即激活词）
    const name =
      str(it.name || it.entry_name || it.entryName || it.title) ||
      triggers[0] ||
      content.slice(0, 24)
    list.push({
      name,
      type: '设定',
      triggers: triggers.length ? triggers : [name],
      content,
      firstAppeared: 0,
      lastAppeared: 0,
      active: it.enabled !== false && it.enable !== false,
    })
  }
  return list
}

/** 引导页提取：优先 HTML 引导页，其次含 HTML 的描述，再其次开场白（无则保持空，不生成） */
function guideFrom(obj: Record<string, unknown>, root: Record<string, unknown>): string | undefined {
  const direct = str(flexGet(root, 'guide', 'guide_html', 'guideHtml', 'introPage', 'landingPage', 'detailIntro'))
  if (direct && /<[a-z]/i.test(direct)) return direct
  const desc = str(flexGet(root, 'description'))
  if (desc && /<!doctype|<html|<div|<section|<style/i.test(desc)) return desc
  const opening = str(flexGet(root, 'opening_statement', 'openingStatement', 'first_mes', 'firstMes', 'greetings'))
    || (Array.isArray((obj as Record<string, unknown>).braindance)
      ? str(flexGet((obj as Record<string, unknown>).braindance as Record<string, unknown>, 'openings'))
      : '')
  return opening || undefined
}

/**
 * 规则映射解析：识别常见平台格式（春潮/风月/MISS/日礼/春水/酒馆），
 * 按语义映射直接提取为 Script。识别失败返回 null（交由 AI 兜底）。
 */
function parseByRules(obj: Record<string, unknown>): Script | null {
  const format = detectFormat(obj)
  if (!format) return null

  // 定位各平台核心对象
  let root = obj
  let promptRoot = obj
  let wbRaw: unknown = undefined

  if (format === 'chunchao') {
    root = (obj.work as Record<string, unknown>) || obj
    promptRoot = root
  } else if (format === 'chunshui') {
    root = (obj.braindance as Record<string, unknown>) || obj
    promptRoot = root
  } else if (format === 'miss') {
    promptRoot = (obj.promptData as Record<string, unknown>) || obj
  } else if (format === 'sillytavern') {
    const d = (obj.data || obj.character) as Record<string, unknown> | undefined
    if (d) {
      root = d
      promptRoot = d
    }
    const cb = (d?.character_book as Record<string, unknown> | undefined)?.entries
    if (Array.isArray(cb)) wbRaw = cb
  }

  const title = str(flexGet(root, 'name', 'title', 'script_name', 'scriptName')) || str(flexGet(obj, 'name', 'title'))
  // 简介优先用 summary（纯文本摘要，避免从 HTML 宣发页截取）；无 summary 时取 description 首行（如日礼）
  const description =
    cleanDescription(flexGet(root, 'summary', 'intro')) ||
    firstMeaningfulLine(cleanDescription(flexGet(root, 'description', 'detailIntro')))
  const tags = tagsFrom(flexGet(root, 'tags', 'categories', 'labels', 'tagIds'))
  const cover = str(flexGet(root, 'coverUrl', 'cover', 'cover_url', 'coverImage')) || str(flexGet(obj, 'cover', 'coverUrl'))

  // 提示词按顺序拼接：破甲词 → 前置词 → 主提示词 → 后置词 → 文风
  const breakArmor = str(flexGet(promptRoot, 'breakArmorWord', 'jailbreakPrompt'))
  const prePrompt = str(flexGet(promptRoot, 'prePrompt', 'pre_prompt'))
  const mainPrompt = str(flexGet(promptRoot, 'mainPrompt', 'systemPrompt', 'system_prompt', 'prompt'))
  const suffix = str(flexGet(promptRoot, 'suffixPrompt', 'postPrompt', 'post_prompt', 'post_text'))
  const writingStyle = str(flexGet(promptRoot, 'writingStylePrompt', 'writingStyle'))
  const outputRules = str(flexGet(promptRoot, 'outputRules', 'output_rules', 'outputRule', 'output_format', 'outputFormat'))
  // 按顺序拼接：破甲词 → 前置 → 主提示词 → 后置 → 文风 → 输出规则，过滤整个字段即为占位符的情况（如春水格式的"前置词标识/输出格式标识"）
  const prompt = [breakArmor, prePrompt, mainPrompt, suffix, writingStyle, outputRules]
    .filter((p) => p && p.length > 5 && !/^(前置词标识|输出格式标识|占位|placeholder|无|暂无)$/i.test(p.trim()))
    .join('\n\n')

  const wb = worldbookFrom(
    wbRaw ??
      flexGet(
        root,
        'world_book',
        'worldbook',
        'worldBook',
        'worldBookEntries',
        'worldBookEntry',
        'world_info',
        'worldInfo',
        'embeddedWorldBook',
        'definitions',
        'entries'
      )
  )
  const guide = guideFrom(obj, root)

  return {
    meta: {
      id: '',
      title: title || '导入的剧本',
      description,
      coverUrl: cover || undefined,
      tags,
      createdAt: 0,
      updatedAt: 0,
      playCount: 0,
    },
    prompt,
    worldbook: wb,
    guide,
  }
}

/** 导入阶段（供 UI 展示进度提示） */
export type ImportPhase = 'mapped' | 'ai'

/**
 * 主流程：把任意 JSON 文本导入为剧本。
 * - 自家 .ink.json 格式 → 直接解析
 * - 常见平台格式（春潮/风月/MISS/日礼/春水/酒馆）→ 规则映射解析（秒级，不依赖 AI）
 * - 其他任意格式 → 交给 AI 分析提取（兜底）
 * @param onPhase 阶段回调：mapped=规则映射命中；ai=走 AI 分析（较慢）
 */
export async function importScriptFromJSON(jsonText: string, onPhase?: (phase: ImportPhase) => void): Promise<Script> {
  if (isInkTavernJSON(jsonText)) {
    const script = parseInkTavernJSON(jsonText)
    if (script) return script
  }

  // 规则映射：识别常见平台，秒级导入，不消耗 AI
  const obj = safeParse(jsonText)
  if (obj && typeof obj === 'object') {
    const script = parseByRules(obj as Record<string, unknown>)
    if (script) {
      onPhase?.('mapped')
      return script
    }
  }

  // AI 兜底
  onPhase?.('ai')
  const messages = buildImportPrompt(jsonText)
  const reply = await chatCompletion(messages)
  const data = extractJSON(reply)
  if (!data || typeof data !== 'object') {
    throw new Error('AI 解析剧本失败，请重试或检查文件内容')
  }

  return normalizeScript(data as Record<string, unknown>)
}

/** 把 AI 返回的数据规范化为 Script */
function normalizeScript(data: Record<string, unknown>): Script {
  const wb: WorldbookEntry[] = Array.isArray(data.worldbook)
    ? (data.worldbook as Array<Record<string, unknown>>)
        .map((w) => {
          const name = String(w.name || w.key || w.title || '').trim()
          const content = String(w.content || w.value || w.description || '').trim()
          if (!name || !content) return null
          return {
            name,
            type: String(w.type || '设定'),
            triggers: Array.isArray(w.triggers)
              ? w.triggers.map(String).filter(Boolean)
              : [name],
            content,
            firstAppeared: 0,
            lastAppeared: 0,
            active: true,
          }
        })
        .filter((w): w is WorldbookEntry => w !== null)
    : []

  const guide = data.guide ? String(data.guide) : undefined
  return {
    meta: {
      id: '',
      title: String(data.title || '导入的剧本'),
      description: String(data.description || ''),
      coverUrl: data.coverUrl ? String(data.coverUrl) : undefined,
      tags: Array.isArray(data.tags) ? data.tags.map(String).filter(Boolean) : [],
      createdAt: 0,
      updatedAt: 0,
      playCount: 0,
    },
    prompt: String(data.prompt || ''),
    worldbook: wb,
    guide,
  }
}
