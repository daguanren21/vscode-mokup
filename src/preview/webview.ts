import { Uri, workspace } from 'vscode'
import type { MockRoute } from '../mock/routes'
import { buildPreview } from './parse'

export async function readRouteFile(filePath: string): Promise<string> {
  try {
    const bytes = await workspace.fs.readFile(Uri.file(filePath))
    return Buffer.from(bytes).toString('utf8')
  }
  catch {
    return ''
  }
}

export function renderPreviewHtml(route: MockRoute, raw: string): string {
  const preview = buildPreview(route, raw)
  const title = `${route.method.toUpperCase()} ${route.path}`
  const escaped = escapeHtml(preview.text || '// empty')
  const source = escapeHtml(route.sourceFile)
  const meta = escapeHtml(preview.meta)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: light dark; }
    body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; padding: 16px; }
    h1 { font-size: 14px; margin: 0 0 8px; }
    .meta { color: #888; font-size: 12px; margin-bottom: 12px; }
    pre { background: rgba(127,127,127,0.1); padding: 12px; border-radius: 6px; white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="meta">${source} · ${meta}</div>
  <pre>${escaped}</pre>
</body>
</html>`
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
