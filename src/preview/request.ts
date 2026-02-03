import type { WebviewPanel } from 'vscode'

type PreviewRequestMessage = {
  type: 'sendRequest'
  id?: string
  payload?: {
    method?: string
    url?: string
    headers?: Record<string, unknown>
    body?: string
  }
}

type PreviewResponseMessage = {
  type: 'response'
  id: string
  ok: boolean
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: string
  durationMs?: number
  error?: string
}

export async function handlePreviewRequestMessage(panel: WebviewPanel, message: unknown): Promise<boolean> {
  if (!message || typeof message !== 'object')
    return false
  const payload = message as PreviewRequestMessage
  if (payload.type !== 'sendRequest')
    return false

  const id = typeof payload.id === 'string' ? payload.id : `${Date.now()}`
  const method = String(payload.payload?.method ?? 'GET').toUpperCase()
  const url = String(payload.payload?.url ?? '')
  const headers = normalizeHeaders(payload.payload?.headers)
  const bodyText = typeof payload.payload?.body === 'string' ? payload.payload?.body : ''

  const reply = async (data: PreviewResponseMessage) => {
    await panel.webview.postMessage(data)
  }

  if (!url) {
    await reply({ type: 'response', id, ok: false, error: '请求地址为空' })
    return true
  }

  if (typeof fetch !== 'function') {
    await reply({ type: 'response', id, ok: false, error: '当前运行环境不支持 fetch' })
    return true
  }

  const controller = new AbortController()
  const started = Date.now()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const allowBody = method !== 'GET' && method !== 'HEAD'
    const response = await fetch(url, {
      method,
      headers,
      body: allowBody && bodyText ? bodyText : undefined,
      signal: controller.signal,
    })
    const text = await response.text()
    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })
    await reply({
      type: 'response',
      id,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: text,
      durationMs: Date.now() - started,
    })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await reply({
      type: 'response',
      id,
      ok: false,
      error: message,
      durationMs: Date.now() - started,
    })
  }
  finally {
    clearTimeout(timeout)
  }

  return true
}

function normalizeHeaders(input: Record<string, unknown> | undefined): Record<string, string> {
  if (!input || typeof input !== 'object')
    return {}
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!key)
      continue
    headers[key] = value == null ? '' : String(value)
  }
  return headers
}
