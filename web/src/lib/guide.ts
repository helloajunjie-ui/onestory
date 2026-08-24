// 引导页 HTML 工具：完整文档剥离 + iframe 桥接文档构建
// （移植自 src/components/guide-frame.tsx，逻辑保持一致）

import type { Script } from '@/lib/types'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 剧本未提供引导页时，生成默认的「开始冒险」引导页，保证新档走正规引导流程 */
export function buildDefaultGuideHtml(script: Script): string {
  const title = escapeHtml(script.meta.title || '新冒险')
  const desc = escapeHtml(script.meta.description || '开始你的故事')
  return `<div class="char-create">
  <h1>${title}</h1>
  <p>${desc}</p>
  <label>你的名字（可选）</label>
  <input type="text" id="name" placeholder="给自己取个名字" />
  <button>开始游戏</button>
</div>`
}

export function extractGuideParts(html: string): { bodyContent: string; styleContent: string } {
  // 仅当内容以 <!doctype html 或 <html 开头时，才视为完整文档进行剥离
  if (/^\s*<!doctype\s+html/i.test(html) || /^\s*<html/i.test(html)) {
    // 提取 <style>...</style> 内容（含 <style> 标签本身）
    const styleMatch = html.match(/<style[\s\S]*?<\/style>/gi)
    const styleContent = styleMatch ? styleMatch.join('\n') : ''
    // 提取 <body ...>...</body> 内部内容
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    const bodyContent = bodyMatch ? bodyMatch[1] : html
    return { bodyContent, styleContent }
  }
  // 非完整文档：原样注入
  return { bodyContent: html, styleContent: '' }
}

export function buildGuideHtml(html: string, preview = false): string {
  const { bodyContent, styleContent } = extractGuideParts(html)
  // 预览模式：iframe 固定高度填满容器，内容在 iframe 内部滚动
  const heightRule = preview ? 'html, body { height: 100%; }\n    ' : ''
  const bodyOverflow = preview ? 'overflow-y: auto;\n      ' : ''
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ${heightRule}body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #e4e4e7;
      background: transparent;
      padding: 8px;
      line-height: 1.6;
      ${bodyOverflow}}
    input, textarea, select, button {
      font-family: inherit;
      font-size: 14px;
    }
    input, textarea, select {
      width: 100%;
      padding: 8px 12px;
      background: #18181b;
      border: 1px solid #3f3f46;
      border-radius: 6px;
      color: #e4e4e7;
      outline: none;
      margin-top: 4px;
    }
    input:focus, textarea:focus, select:focus {
      border-color: #d97706;
    }
    label {
      display: block;
      font-size: 13px;
      color: #a1a1aa;
      margin-top: 12px;
    }
    button {
      padding: 8px 20px;
      background: #d97706;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      margin-top: 16px;
    }
    button:hover { background: #f59e0b; }
    h1 { font-size: 20px; margin-bottom: 8px; color: #f59e0b; }
    h2 { font-size: 16px; margin-top: 16px; margin-bottom: 6px; color: #d4d4d8; }
    p { margin-bottom: 8px; color: #a1a1aa; }
    .char-create { max-width: 400px; margin: 0 auto; }
  </style>
  ${styleContent}
</head>
<body>
  <div id="root">${bodyContent}</div>
  <script>
    (function() {
      window.parent.postMessage({ type: 'ink-tavern-ready' }, '*');
      document.addEventListener('submit', function(e) {
        e.preventDefault();
        collectAndSubmit();
      });
      document.addEventListener('click', function(e) {
        var btn = e.target.closest('button');
        if (btn && !btn.closest('form')) {
          collectAndSubmit();
        }
      });
      function collectAndSubmit() {
        var data = {};
        var inputs = document.querySelectorAll('input, textarea, select');
        inputs.forEach(function(el) {
          if (el.name || el.id) {
            data[el.name || el.id] = el.value;
          }
        });
        window.parent.postMessage({ type: 'ink-tavern-submit', data: data }, '*');
      }
      window.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'ink-tavern-set') {
          Object.keys(event.data.data).forEach(function(key) {
            var el = document.getElementById(key) || document.querySelector('[name="' + key + '"]');
            if (el) el.value = event.data.data[key];
          });
        }
      });
    })();
  </script>
</body>
</html>`.trim()
}
