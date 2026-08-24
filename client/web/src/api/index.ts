// 类型化 API 函数（映射 Go 后端 REST 端点）

import type {
  Script,
  ScriptMeta,
  SaveData,
  SaveMeta,
  AIConfig,
  AppearanceConfig,
  CloudConfig,
  LibraryItem,
} from '@/lib/types'
import { request, ApiError } from './client'

// ==================== 剧本 ====================
export const listScripts = () => request<ScriptMeta[]>('/api/scripts')
export const getScript = (id: string) => request<Script>(`/api/scripts/${encodeURIComponent(id)}`)
export const createScript = (script: Script) =>
  request<{ id: string }>('/api/scripts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(script),
  })
export const updateScript = (id: string, patch: Partial<Script>) =>
  request<{ ok: boolean }>(`/api/scripts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
export const deleteScript = (id: string) =>
  request<{ ok: boolean }>(`/api/scripts/${encodeURIComponent(id)}`, { method: 'DELETE' })

// ==================== 存档 ====================
export const listSaves = (scriptId: string) =>
  request<SaveMeta[]>(`/api/saves?scriptId=${encodeURIComponent(scriptId)}`)
export const getSave = (id: string) => request<SaveData>(`/api/saves/${encodeURIComponent(id)}`)
export const createSave = (scriptId: string, name?: string) =>
  request<{ id: string }>('/api/saves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scriptId, name }),
  })
export const updateSave = (id: string, patch: Partial<SaveData>) =>
  request<{ ok: boolean }>(`/api/saves/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
export const deleteSave = (id: string) =>
  request<{ ok: boolean }>(`/api/saves/${encodeURIComponent(id)}`, { method: 'DELETE' })

// ==================== 背景图 / 资源 ====================
export const loadBgImage = () => request<{ data: string }>('/api/bg-image').then((r) => r.data)
export const saveBgImage = (data: string) =>
  request<{ ok: boolean }>('/api/bg-image', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  })

// ==================== 设置 ====================
export const getAiSettings = () => request<AIConfig>('/api/settings/ai')
export const saveAiSettings = (patch: Partial<AIConfig>) =>
  request<{ ok: boolean }>('/api/settings/ai', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
export const getAppearanceSettings = () => request<AppearanceConfig>('/api/settings/appearance')
export const saveAppearanceSettings = (patch: Partial<AppearanceConfig>) =>
  request<{ ok: boolean }>('/api/settings/appearance', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
export const getCloudSettings = () => request<CloudConfig>('/api/settings/cloud')
export const saveCloudSettings = (patch: Partial<CloudConfig>) =>
  request<{ ok: boolean }>('/api/settings/cloud', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })

// ==================== 客户端 UID ====================
/** 获取/生成客户端内部 UID（10 位数字字母，云端公共库鉴权用） */
export const getClientUid = () => request<{ uid: string }>('/api/client/uid').then((r) => r.uid)

// ==================== 云端公共剧本库 ====================
// 云端服务是独立部署的（默认 http://localhost:8787），请求走配置的 libraryBaseUrl（绝对地址），
// 全部请求需带 X-UID 身份标识（云端鉴权 + 防外部拉取）
function cloudURL(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, '') + path
}
function uidHeaders(uid: string): Record<string, string> {
  return { 'X-UID': uid }
}

/** 目录列表（q 匹配标题/简介/标签，空则返回全部） */
export const listLibraryScripts = (baseUrl: string, uid: string, q?: string) =>
  request<LibraryItem[]>(cloudURL(baseUrl, '/api/scripts') + (q ? `?q=${encodeURIComponent(q)}` : ''), {
    headers: uidHeaders(uid),
  })

/** 下载某个剧本的 .ink.json 原文（对象） */
export const getLibraryScript = (baseUrl: string, uid: string, id: string) =>
  request<unknown>(cloudURL(baseUrl, `/api/scripts/${encodeURIComponent(id)}`), {
    headers: uidHeaders(uid),
  })

/** 上传 .ink.json 文本到公共库（云端以 X-UID 记录上传者身份） */
export const uploadLibraryScript = (baseUrl: string, uid: string, inkJson: string) =>
  request<{ id: string }>(cloudURL(baseUrl, '/api/scripts'), {
    method: 'POST',
    headers: { ...uidHeaders(uid), 'Content-Type': 'application/json' },
    body: inkJson,
  })

/** 删除公共库剧本（仅上传者本人可删） */
export const deleteLibraryScript = (baseUrl: string, uid: string, id: string) =>
  request<{ ok: boolean }>(cloudURL(baseUrl, `/api/scripts/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: uidHeaders(uid),
  })

// ==================== 备份 ====================
export async function exportBackup(): Promise<void> {
  const res = await fetch('/api/backup/export')
  if (!res.ok) throw new ApiError(res.status, '导出失败')
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') || ''
  const m = cd.match(/filename="?([^"]+)"?/)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = m ? m[1] : 'ink-tavern-backup.itb'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export const importBackup = (file: File) =>
  request<{ scripts: number; saves: number }>('/api/backup/import', {
    method: 'POST',
    body: file,
  })

// ==================== AI ====================
export const fetchModels = () => request<string[]>('/api/ai/models')
