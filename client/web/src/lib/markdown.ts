import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Markdown 渲染（marked + DOMPurify）。
// 样式通过 main.css 中 .markdown-body 类的 CSS 规则复刻旧版 react-markdown components 覆写，
// 详见 assets/main.css。

marked.setOptions({ gfm: true })

export function renderMarkdown(content: string): string {
  const raw = marked.parse(content, { async: false }) as string
  // 允许内嵌 HTML（对应旧版 rehype-raw），但经 DOMPurify 消毒防 XSS
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
}
