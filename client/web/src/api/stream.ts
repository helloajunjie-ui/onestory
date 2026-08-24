// AI 对话流式/非流式请求（走 Go 后端代理 /api/ai/chat/completions）
// 移植自 src/lib/ai/client.ts，SSE 解析逻辑保持一致

import type { ChatMessage } from './client'
import { useConfigStore } from '@/stores/config'

export interface StreamCallbacks {
  onToken: (token: string) => void
  onDone: (fullText: string) => void
  onError: (error: Error) => void
  /** 推理内容回调（DeepSeek 等推理模型正文前输出大量推理，可用于显示"思考中"占位） */
  onReasoning?: (reasoning: string) => void
}

/** 流式对话（SSE 打字机效果） */
export async function streamChat(
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const { aiConfig } = useConfigStore()

  try {
    const response = await fetch('/api/ai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: aiConfig.model, messages, stream: true, temperature: 0.8 }),
      signal,
    })

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`
      try {
        const data = await response.json()
        if (data?.error) errorMsg = data.error
      } catch {
        /* ignore */
      }
      callbacks.onError(new Error(errorMsg))
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      callbacks.onError(new Error('响应体不可读'))
      return
    }

    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta ?? {}
          const content = delta.content ?? ''
          const reasoning = delta.reasoning_content ?? ''
          // 推理模型的思考过程（不影响正文，用于触发"思考中"占位）
          if (reasoning) callbacks.onReasoning?.(reasoning)
          if (content) {
            fullText += content
            callbacks.onToken(content)
          }
        } catch {
          // 跳过解析失败的行
        }
      }
    }

    callbacks.onDone(fullText)
  } catch (err) {
    // 用户主动停止生成（AbortError）时静默结束
    if (signal?.aborted) return
    const error = err instanceof Error ? err : new Error(String(err))
    if (error.message.includes('fetch') || error.message.includes('NetworkError')) {
      callbacks.onError(new Error('网络连接失败，请检查后端服务或网络'))
    } else {
      callbacks.onError(error)
    }
  }
}

/** 非流式对话（用于 L2 记忆提取等后台任务） */
export async function chatCompletion(messages: ChatMessage[]): Promise<string> {
  const { aiConfig } = useConfigStore()
  const response = await fetch('/api/ai/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 不设 max_tokens：推理模型（如 DeepSeek v4）正文不受限，由上游决定
    body: JSON.stringify({ model: aiConfig.model, messages, stream: false, temperature: 0.5 }),
  })
  if (!response.ok) {
    let msg = `API 请求失败: ${response.status}`
    try {
      const data = await response.json()
      if (data?.error) msg = data.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  const data = await response.json()
  return data.choices?.[0]?.message?.content ?? ''
}
