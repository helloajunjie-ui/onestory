// 统一对话执行引擎（移植自 src/hooks/useChatEngine.ts，逻辑一致）
// 职责：组装 Prompt、流式/非流式请求、保存 AI 回复、L2 提取、分页跳转、状态清理

import { toValue, type MaybeRefOrGetter } from 'vue'
import type { Script, SaveData } from '@/lib/types'
import { updateSave } from '@/api'
import { streamChat, chatCompletion } from '@/api/stream'
import { buildPrompt } from '@/lib/prompt-builder'
import { processMemoryUpdate, buildL2ExtractionPrompt, buildSummarizePrompt, L2_CONFIG } from '@/lib/memory-engine'
import { logger } from '@/lib/logger'

export interface ExecuteChatParams {
  userInput: string
  baseSave: SaveData
  turn: number
  regenerated?: boolean
}

export interface ChatEngineOptions {
  /** 支持响应式：传入 ref/getter 时每次 executeChat 取最新值 */
  script: MaybeRefOrGetter<Script | null>
  useStreamMode: MaybeRefOrGetter<boolean>
  onStreamToken?: (token: string) => void
  onStreamDone?: (fullText: string) => void
  onStreamError?: (error: Error) => void
  onSaveDataUpdate?: (data: SaveData) => void
  onL2Update?: (data: SaveData) => void
  onPageUpdate?: (totalPages: number) => void
  onStreamingChange?: (streaming: boolean) => void
  onThinkingChange?: (thinking: boolean) => void
  /** 流式失败自动降级为非流式后回调（用于同步 UI 模式切换，避免下次重复流式失败） */
  onAutoSwitchMode?: () => void
}

export function useChatEngine(options: ChatEngineOptions) {
  const {
    script,
    useStreamMode,
    onStreamToken,
    onStreamDone,
    onStreamError,
    onSaveDataUpdate,
    onL2Update,
    onPageUpdate,
    onStreamingChange,
    onThinkingChange,
    onAutoSwitchMode,
  } = options

  let abortController: AbortController | null = null

  /** 后台异步 L2 实体提取（不阻塞 UI） */
  async function performL2Extraction(withAi: SaveData, userInput: string, aiReply: string) {
    try {
      const l2Messages = buildL2ExtractionPrompt(withAi.history, userInput, aiReply, withAi.dynamicWorldbook)
      const l2Result = await chatCompletion(l2Messages)
      logger.debug('ChatEngine', `L2 提取完成，结果长度=${l2Result.length}`)
      const updated = processMemoryUpdate(l2Result, withAi)

      // 自动总结超长记忆：单条超过 MAX_CONTENT_LENGTH 字时，调用 AI 压缩保留关键信息
      const overlong = updated.dynamicWorldbook.filter(
        (e) => e.content.length > L2_CONFIG.MAX_CONTENT_LENGTH
      )
      if (overlong.length > 0) {
        logger.info('ChatEngine', `发现 ${overlong.length} 条超长记忆，开始 AI 总结`)
        for (const entry of overlong) {
          try {
            const summary = await chatCompletion(buildSummarizePrompt(entry))
            if (summary && summary.trim()) {
              entry.content = summary.trim().slice(0, L2_CONFIG.MAX_CONTENT_LENGTH)
              logger.info('ChatEngine', `已总结条目「${entry.name}」`)
            }
          } catch (e) {
            logger.warn('ChatEngine', `条目「${entry.name}」总结失败，保留原内容`)
          }
        }
      }

      if (onL2Update) {
        // 函数式合并 dynamicWorldbook，避免 stale closure 覆盖新消息
        onL2Update(updated)
      } else {
        await updateSave(withAi.meta.id, { dynamicWorldbook: updated.dynamicWorldbook }).catch(
          (e) =>
            logger.error('ChatEngine', `L2 存储写入失败: ${e instanceof Error ? e.message : String(e)}`)
        )
      }
    } catch (err) {
      logger.error('ChatEngine', `L2 提取异常: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** 执行单次对话 */
  async function executeChat(params: ExecuteChatParams) {
    const { userInput, baseSave, turn, regenerated = false } = params
    // 每次执行时取最新响应式值（script/useStreamMode 可被组件动态切换）
    const currentScript = toValue(script)
    const streamMode = toValue(useStreamMode)

    if (!userInput.trim()) {
      logger.warn('ChatEngine', '用户输入为空，中止对话')
      return
    }
    if (!currentScript) {
      logger.warn('ChatEngine', '剧本未加载，中止对话')
      return
    }

    logger.debug('ChatEngine', `executeChat 开始 input长度=${userInput.length} turn=${turn}`)

    const chatHistory = buildPrompt({
      script: currentScript,
      saveData: baseSave,
      userInput,
      history: baseSave.history,
    })

    try {
      abortController = new AbortController()
      let fullText = ''

      if (streamMode) {
        let streamFailed = false
        let reasoningActive = false
        await streamChat(
          chatHistory,
          {
            onToken: (token) => {
              // 推理结束、正文开始，关闭"思考中"占位
              if (reasoningActive) {
                reasoningActive = false
                onThinkingChange?.(false)
              }
              fullText += token
              onStreamToken?.(token)
            },
            onDone: (text) => {
              if (reasoningActive) {
                reasoningActive = false
                onThinkingChange?.(false)
              }
              fullText = text
              onStreamDone?.(text)
            },
            onError: () => {
              streamFailed = true
            },
            // 推理模型（DeepSeek v4 等）正文前输出大量推理，期间显示"正在思考"
            onReasoning: () => {
              if (!reasoningActive) {
                reasoningActive = true
                onThinkingChange?.(true)
              }
            },
          },
          abortController.signal
        )
        // 流式请求失败（非用户手动停止）时，自动降级为非流式重试，
        // 适配不支持流式输出的模型
        if (streamFailed && !abortController.signal.aborted) {
          logger.warn('ChatEngine', '流式请求失败，自动降级为非流式重试')
          fullText = await chatCompletion(chatHistory)
          onStreamToken?.(fullText)
          onStreamDone?.(fullText)
          // 通知 UI 把模式自动切到非流，防止下次重复流式失败
          onAutoSwitchMode?.()
          onStreamError?.(new Error('该模型可能不支持流式输出，已自动切换为非流模式。'))
        }
      } else {
        fullText = await chatCompletion(chatHistory)
        onStreamToken?.(fullText)
        onStreamDone?.(fullText)
      }

      // 保存 AI 回复
      const aiMsg = {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        content: fullText,
        timestamp: Date.now(),
        turn,
        edited: false,
        regenerated,
      }
      const withAi: SaveData = {
        ...baseSave,
        history: [...baseSave.history, aiMsg],
      }
      await updateSave(baseSave.meta.id, withAi)
      onSaveDataUpdate?.(withAi)

      // 计算新的总页数并跳转到最新页
      const uniqueTurns = new Set(withAi.history.map((m) => m.turn))
      const totalPages = Math.max(1, Math.ceil(uniqueTurns.size / 50))
      onPageUpdate?.(totalPages)

      // 后台异步执行 L2 提取
      performL2Extraction(withAi, userInput, fullText)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      logger.error('ChatEngine', `执行对话异常: ${error.message}`)
      onStreamError?.(error)
    } finally {
      abortController = null
      onStreamingChange?.(false)
      onThinkingChange?.(false)
    }
  }

  /** 停止当前流式请求 */
  function stop() {
    abortController?.abort()
    abortController = null
  }

  return { executeChat, stop }
}
