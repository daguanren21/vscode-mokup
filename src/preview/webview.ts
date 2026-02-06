import { Uri, workspace, type Webview } from 'vscode'
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

export type RequestPreviewOptions = {
  cspSource: string
  baseUrl?: string
  instanceLabel?: string
  webview: Webview
  extensionUri: Uri
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
  <div class="meta">${source} / ${meta}</div>
  <pre>${escaped}</pre>
</body>
</html>`
}

export function renderRequestPreviewHtml(route: MockRoute, raw: string, options: RequestPreviewOptions): string {
  const preview = buildPreview(route, raw)
  const baseUrl = options.baseUrl?.trim() ?? ''
  const instanceLabel = options.instanceLabel?.trim() ?? ''
  const note = baseUrl
    ? `Detected running instance: ${instanceLabel || 'mokup'} (${baseUrl})`
    : 'No running mock instance. Online mode will auto-start; offline mode is local only.'
  const nonce = createNonce()
  const initialState = safeJson({
    baseUrl,
    method: route.method.toUpperCase(),
    path: route.path,
    previewText: preview.text,
    sourceFile: route.sourceFile,
    meta: preview.meta,
    note,
  })
  const scriptUri = options.webview.asWebviewUri(
    Uri.joinPath(options.extensionUri, 'res', 'webview', 'index.js'),
  )
  const styleUri = options.webview.asWebviewUri(
    Uri.joinPath(options.extensionUri, 'res', 'webview', 'style.css'),
  )

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${options.cspSource} data:; style-src ${options.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${options.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">window.__MOKUP_STATE__ = ${initialState};</script>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
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

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 32; i++)
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  return result
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
