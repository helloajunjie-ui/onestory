// 通用 fetch 封装

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { signal, ...rest } = options
  let res: Response
  try {
    res = await fetch(path, { ...rest, signal })
  } catch (err) {
    // 主动中止（AbortError）时原样上抛，由调用方处理
    if (signal?.aborted) throw err
    throw new ApiError(0, '网络连接失败，请检查后端服务是否已启动')
  }
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`
    try {
      const data = await res.json()
      if (data && typeof data.error === 'string' && data.error) msg = data.error
    } catch {
      /* 非 JSON 错误体忽略 */
    }
    throw new ApiError(res.status, msg)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}
