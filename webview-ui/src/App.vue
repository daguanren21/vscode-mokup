<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

type InitialState = {
  baseUrl?: string
  method?: string
  path?: string
  previewText?: string
  sourceFile?: string
  meta?: string
  note?: string
}

declare global {
  interface Window {
    __MOKUP_STATE__?: InitialState
    acquireVsCodeApi?: () => { postMessage: (data: unknown) => void }
  }
}

const emptyState: Required<InitialState> = {
  baseUrl: '',
  method: 'GET',
  path: '/',
  previewText: '',
  sourceFile: '',
  meta: '',
  note: '',
}

const initial = (() => {
  const raw = typeof window !== 'undefined' ? window.__MOKUP_STATE__ : undefined
  if (raw && typeof raw === 'object')
    return { ...emptyState, ...raw }
  if (import.meta.env.DEV) {
    return {
      ...emptyState,
      method: 'GET',
      path: '/api/example',
      previewText: JSON.stringify({ ok: true, data: [] }, null, 2),
      sourceFile: 'mock/example.get.ts',
      meta: 'parsed export default',
      note: 'Dev mode preview. Offline only.',
    }
  }
  return emptyState
})()

const vscode = typeof window !== 'undefined' && window.acquireVsCodeApi
  ? window.acquireVsCodeApi()
  : { postMessage: () => {} }

const methodOptions = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const envOptions = ['Default', 'Local', 'Staging', 'Production']

const form = reactive({
  mode: 'online',
  method: initial.method,
  baseUrl: initial.baseUrl,
  pathParams: '',
  queryParams: '',
  headers: '',
  body: '',
  environment: 'Default',
})

const requestTab = ref<'params' | 'headers' | 'body' | 'auth' | 'scripts' | 'settings'>('params')
const responseTab = ref<'body' | 'headers' | 'raw' | 'console'>('body')

const errors = reactive({
  baseUrl: '',
  pathParams: '',
  queryParams: '',
  headers: '',
  body: '',
})

const response = reactive({
  status: '--',
  statusText: '',
  duration: '--',
  headers: '// empty',
  body: '// empty',
  error: '',
})

const resolvedUrl = ref('--')
const sending = ref(false)
const pendingEnsure = ref(false)
let lastRequestId = ''

const routeLabel = computed(() => `${initial.method} ${initial.path}`.trim())
const sendLabel = computed(() => {
  if (form.mode === 'offline')
    return 'Render Offline'
  return sending.value ? 'Sending...' : 'Send'
})

function parseJsonField(text: string, key: keyof typeof errors) {
  const value = text.trim()
  if (!value) {
    errors[key] = ''
    return { ok: true, value: {} }
  }
  try {
    const parsed = JSON.parse(value)
    errors[key] = ''
    return { ok: true, value: parsed }
  }
  catch {
    errors[key] = 'Invalid JSON'
    return { ok: false }
  }
}

function buildPath(template: string, params: Record<string, unknown>) {
  return template.replace(/\{([^}]+)\}/g, (raw, key) => {
    const value = Object.prototype.hasOwnProperty.call(params, key) ? params[key] : undefined
    if (value === undefined || value === null || value === '')
      return raw
    return encodeURIComponent(String(value))
  })
}

function buildQuery(obj: Record<string, unknown>) {
  if (!obj || typeof obj !== 'object')
    return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      for (const item of value)
        params.append(key, item == null ? '' : String(item))
      continue
    }
    if (value && typeof value === 'object') {
      params.append(key, JSON.stringify(value))
      continue
    }
    params.append(key, value == null ? '' : String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

function joinUrl(base: string, path: string) {
  const trimmedBase = base.replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return trimmedBase + normalizedPath
}

function updateResolvedUrl() {
  const paramsResult = parseJsonField(form.pathParams, 'pathParams')
  const queryResult = parseJsonField(form.queryParams, 'queryParams')
  if (!paramsResult.ok || !queryResult.ok) {
    resolvedUrl.value = '--'
    return
  }
  const pathValue = buildPath(initial.path, paramsResult.value as Record<string, unknown>)
  const queryValue = buildQuery(queryResult.value as Record<string, unknown>)
  const base = form.baseUrl.trim()
  const url = base ? joinUrl(base, pathValue) + queryValue : pathValue + queryValue
  resolvedUrl.value = url || '--'
}

watch(
  () => [form.baseUrl, form.pathParams, form.queryParams],
  () => updateResolvedUrl(),
  { immediate: true },
)

function resolveTemplateValue(expr: string, context: Record<string, unknown>) {
  const tokens: string[] = []
  const re = /([A-Za-z_$][\w$]*)|\[(?:\"([^\"]+)\"|'([^']+)'|([^\]]+))\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(expr))) {
    const token = match[1] || match[2] || match[3] || match[4]
    if (token != null && token !== '')
      tokens.push(token.trim())
  }
  if (!tokens.length)
    return undefined
  let current: any = context
  for (const token of tokens) {
    if (current == null)
      return undefined
    if (typeof current === 'object' || Array.isArray(current)) {
      if (Object.prototype.hasOwnProperty.call(current, token)) {
        current = (current as any)[token]
        continue
      }
      const index = Number(token)
      if (Array.isArray(current) && !Number.isNaN(index)) {
        current = current[index]
        continue
      }
      return undefined
    }
    return undefined
  }
  return current
}

function replaceTemplatesInString(text: string, context: Record<string, unknown>) {
  if (!text)
    return text
  return text.replace(/\$\{([^}]+)\}|\{\{([^}]+)\}\}/g, (raw, exprA, exprB) => {
    const expr = (exprA || exprB || '').trim()
    if (!expr)
      return raw
    const value = resolveTemplateValue(expr, context)
    if (value === undefined)
      return raw
    if (value === null)
      return 'null'
    if (typeof value === 'object')
      return JSON.stringify(value)
    return String(value)
  })
}

function resolveWholePlaceholder(text: string, context: Record<string, unknown>) {
  if (!text)
    return undefined
  const trimmed = text.trim()
  const bracketMatch = trimmed.match(/^<([^>]+)>$/)
  if (bracketMatch) {
    const expr = bracketMatch[1].trim()
    const roots = ['body', 'query', 'params', 'headers']
    for (const root of roots) {
      const value = resolveTemplateValue(`${root}.${expr}`, context)
      if (value !== undefined)
        return value
    }
    return resolveTemplateValue(expr, context)
  }
  const tplMatch = trimmed.match(/^\$\{([^}]+)\}$|^\{\{([^}]+)\}\}$/)
  if (tplMatch) {
    const expr = (tplMatch[1] || tplMatch[2] || '').trim()
    if (!expr)
      return undefined
    const value = resolveTemplateValue(expr, context)
    if (value !== undefined)
      return value
  }
  return undefined
}

function applyTemplates(value: any, context: Record<string, unknown>) {
  if (typeof value === 'string') {
    const whole = resolveWholePlaceholder(value, context)
    if (whole !== undefined)
      return whole
    return replaceTemplatesInString(value, context)
  }
  if (Array.isArray(value))
    return value.map(item => applyTemplates(item, context))
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      const nextKey = replaceTemplatesInString(key, context)
      result[nextKey] = applyTemplates(val, context)
    }
    return result
  }
  return value
}

function setResponsePayload(payload: unknown, meta?: { status?: string, duration?: string }) {
  response.error = ''
  response.status = meta?.status ?? response.status
  response.duration = meta?.duration ?? response.duration
  response.headers = response.headers || '// empty'
  if (typeof payload === 'string')
    response.body = payload || '// empty'
  else
    response.body = JSON.stringify(payload ?? {}, null, 2)
}

function performOffline() {
  errors.baseUrl = ''
  const paramsResult = parseJsonField(form.pathParams, 'pathParams')
  const queryResult = parseJsonField(form.queryParams, 'queryParams')
  const headerResult = parseJsonField(form.headers, 'headers')
  const bodyResult = parseJsonField(form.body, 'body')
  if (!paramsResult.ok || !queryResult.ok || !headerResult.ok || !bodyResult.ok)
    return

  let previewValue: unknown = initial.previewText || ''
  if (typeof previewValue === 'string') {
    const trimmed = previewValue.trim()
    if (trimmed && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
      try {
        previewValue = JSON.parse(trimmed)
      }
      catch {
        previewValue = previewValue
      }
    }
  }

  const context = {
    params: paramsResult.value as Record<string, unknown>,
    query: queryResult.value as Record<string, unknown>,
    headers: headerResult.value as Record<string, unknown>,
    body: form.body.trim() ? bodyResult.value as Record<string, unknown> : {},
  }
  previewValue = applyTemplates(previewValue, context)

  response.status = 'OFFLINE'
  response.statusText = ''
  response.duration = '0 ms'
  response.headers = JSON.stringify({ 'x-mokup-mode': 'offline' }, null, 2)
  setResponsePayload(previewValue, { status: 'OFFLINE', duration: '0 ms' })
}

function performRequest() {
  response.error = ''
  if (!form.baseUrl.trim()) {
    errors.baseUrl = 'Base URL required'
    return
  }
  errors.baseUrl = ''

  const paramsResult = parseJsonField(form.pathParams, 'pathParams')
  const queryResult = parseJsonField(form.queryParams, 'queryParams')
  const headerResult = parseJsonField(form.headers, 'headers')
  const bodyResult = parseJsonField(form.body, 'body')
  if (!paramsResult.ok || !queryResult.ok || !headerResult.ok || !bodyResult.ok)
    return

  const pathValue = buildPath(initial.path, paramsResult.value as Record<string, unknown>)
  const queryValue = buildQuery(queryResult.value as Record<string, unknown>)
  const url = joinUrl(form.baseUrl.trim(), pathValue) + queryValue
  resolvedUrl.value = url

  const headerObj = headerResult.value as Record<string, unknown> || {}
  let bodyText = ''
  if (form.body.trim())
    bodyText = JSON.stringify(bodyResult.value)
  const hasContentType = Object.keys(headerObj).some(key => key.toLowerCase() === 'content-type')
  if (bodyText && !hasContentType)
    headerObj['content-type'] = 'application/json'

  lastRequestId = String(Date.now())
  sending.value = true
  response.status = 'SENDING'
  response.duration = '--'
  response.statusText = ''
  response.headers = '// empty'
  response.body = '// empty'

  vscode.postMessage({
    type: 'sendRequest',
    id: lastRequestId,
    payload: {
      method: form.method || initial.method,
      url,
      headers: headerObj,
      body: bodyText,
    },
  })
}

function ensureBaseUrlAndSend() {
  if (form.mode === 'offline') {
    performOffline()
    return
  }
  if (form.baseUrl.trim()) {
    performRequest()
    return
  }
  if (pendingEnsure.value)
    return
  pendingEnsure.value = true
  sending.value = true
  response.status = 'STARTING'
  response.duration = '--'
  response.statusText = ''
  response.body = '// empty'
  response.headers = '// empty'
  vscode.postMessage({ type: 'ensureMock' })
}

function handleEnsureMockResult(message: any) {
  pendingEnsure.value = false
  sending.value = false
  if (!message.ok) {
    response.error = message.error || 'Failed to start mock'
    response.status = 'FAILED'
    response.duration = '--'
    return
  }
  if (message.baseUrl) {
    form.baseUrl = message.baseUrl
    updateResolvedUrl()
  }
  performRequest()
}

function handleResponse(message: any) {
  if (message.id !== lastRequestId)
    return
  sending.value = false
  if (!message.ok) {
    response.error = message.error || 'Request failed'
    response.status = 'FAILED'
    response.duration = `${message.durationMs ?? '--'} ms`
    return
  }
  const status = message.status ?? '--'
  const statusText = message.statusText ? ` ${message.statusText}` : ''
  const duration = message.durationMs ?? '--'
  response.status = String(status)
  response.statusText = statusText
  response.duration = `${duration} ms`
  response.headers = message.headers ? JSON.stringify(message.headers, null, 2) : '// empty'

  const bodyText = message.body ?? ''
  const contentTypeKey = message.headers && Object.keys(message.headers).find((key: string) => key.toLowerCase() === 'content-type')
  const contentType = contentTypeKey ? message.headers[contentTypeKey] : ''
  const maybeJson = typeof contentType === 'string' && contentType.includes('application/json')
  if (maybeJson) {
    try {
      response.body = JSON.stringify(JSON.parse(bodyText), null, 2)
      return
    }
    catch {}
  }
  if (typeof bodyText === 'string' && (bodyText.trim().startsWith('{') || bodyText.trim().startsWith('['))) {
    try {
      response.body = JSON.stringify(JSON.parse(bodyText), null, 2)
      return
    }
    catch {}
  }
  response.body = bodyText || '// empty'
}

const responseView = computed(() => {
  if (responseTab.value === 'headers')
    return response.headers
  if (responseTab.value === 'console')
    return response.error || 'No console output.'
  if (responseTab.value === 'raw')
    return response.body
  return response.body
})

onMounted(() => {
  window.addEventListener('message', (event) => {
    const message = event.data
    if (!message)
      return
    if (message.type === 'ensureMockResult') {
      handleEnsureMockResult(message)
      return
    }
    if (message.type === 'response')
      handleResponse(message)
  })
})
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="brand-dot"></span>
        <span class="brand-text">Mokup Studio</span>
      </div>
      <div class="route-pill">{{ routeLabel }}</div>
      <div class="spacer"></div>
      <div class="topbar-group">
        <label>Mode</label>
        <select v-model="form.mode">
          <option value="online">Online</option>
          <option value="offline">Offline</option>
        </select>
      </div>
      <div class="topbar-group">
        <label>Environment</label>
        <select v-model="form.environment">
          <option v-for="env in envOptions" :key="env" :value="env">{{ env }}</option>
        </select>
      </div>
    </header>

    <div class="main">
      <aside class="sidebar">
        <div class="sidebar-title">Workspace</div>
        <button class="nav-item active">Request</button>
        <button class="nav-item">Collections</button>
        <button class="nav-item">History</button>
        <button class="nav-item">Environments</button>
        <div class="sidebar-footer">
          <div class="mono">{{ initial.sourceFile || 'No source file' }}</div>
          <div class="muted">{{ initial.meta }}</div>
        </div>
      </aside>

      <div class="content">
        <section class="pane">
          <div class="url-row">
            <select v-model="form.method" class="method">
              <option v-for="method in methodOptions" :key="method" :value="method">{{ method }}</option>
            </select>
            <input class="url" :value="resolvedUrl" readonly />
            <button class="send" :disabled="sending" type="button" @click="ensureBaseUrlAndSend">
              {{ sendLabel }}
            </button>
          </div>
          <div class="note">{{ initial.note }}</div>
          <div class="tabs">
            <button :class="['tab', requestTab === 'params' && 'active']" @click="requestTab = 'params'">Params</button>
            <button :class="['tab', requestTab === 'headers' && 'active']" @click="requestTab = 'headers'">Headers</button>
            <button :class="['tab', requestTab === 'body' && 'active']" @click="requestTab = 'body'">Body</button>
            <button :class="['tab', requestTab === 'auth' && 'active']" @click="requestTab = 'auth'">Auth</button>
            <button :class="['tab', requestTab === 'scripts' && 'active']" @click="requestTab = 'scripts'">Scripts</button>
            <button :class="['tab', requestTab === 'settings' && 'active']" @click="requestTab = 'settings'">Settings</button>
          </div>
          <div class="tab-body">
            <template v-if="requestTab === 'params'">
              <div class="field">
                <label>Path Params (JSON)</label>
                <textarea v-model="form.pathParams" spellcheck="false" placeholder="{ &quot;id&quot;: 1 }"></textarea>
                <div class="error">{{ errors.pathParams }}</div>
              </div>
              <div class="field">
                <label>Query Params (JSON)</label>
                <textarea v-model="form.queryParams" spellcheck="false" placeholder="{ &quot;page&quot;: 1 }"></textarea>
                <div class="error">{{ errors.queryParams }}</div>
              </div>
              <div class="field">
                <label>Resolved URL</label>
                <div class="resolved mono">{{ resolvedUrl }}</div>
              </div>
            </template>
            <template v-else-if="requestTab === 'headers'">
              <div class="field">
                <label>Headers (JSON)</label>
                <textarea v-model="form.headers" spellcheck="false" placeholder="{ &quot;Authorization&quot;: &quot;Bearer ...&quot; }"></textarea>
                <div class="error">{{ errors.headers }}</div>
              </div>
            </template>
            <template v-else-if="requestTab === 'body'">
              <div class="field">
                <label>Body (JSON)</label>
                <textarea v-model="form.body" spellcheck="false" placeholder="{ &quot;name&quot;: &quot;Mokup&quot; }"></textarea>
                <div class="error">{{ errors.body }}</div>
              </div>
            </template>
            <template v-else-if="requestTab === 'auth'">
              <div class="placeholder">
                Use the Headers tab to attach Authorization tokens.
              </div>
            </template>
            <template v-else-if="requestTab === 'scripts'">
              <div class="placeholder">
                Pre-request and test scripts are not available in mock preview.
              </div>
            </template>
            <template v-else>
              <div class="field">
                <label>Base URL</label>
                <input v-model="form.baseUrl" type="text" placeholder="http://localhost:3000" />
                <div class="error">{{ errors.baseUrl }}</div>
              </div>
              <div class="field">
                <label>Route</label>
                <div class="resolved mono">{{ routeLabel }}</div>
              </div>
            </template>
          </div>
        </section>

        <section class="pane">
          <div class="response-head">
            <div class="status">
              <span class="chip">{{ response.status }}{{ response.statusText }}</span>
              <span class="chip">Time {{ response.duration }}</span>
            </div>
            <div class="response-tabs">
              <button :class="['tab', responseTab === 'body' && 'active']" @click="responseTab = 'body'">Body</button>
              <button :class="['tab', responseTab === 'headers' && 'active']" @click="responseTab = 'headers'">Headers</button>
              <button :class="['tab', responseTab === 'raw' && 'active']" @click="responseTab = 'raw'">Raw</button>
              <button :class="['tab', responseTab === 'console' && 'active']" @click="responseTab = 'console'">Console</button>
            </div>
          </div>
          <pre class="response-body">{{ responseView }}</pre>
          <div class="error">{{ response.error }}</div>
        </section>

        <section class="pane preview-pane">
          <details>
            <summary>Mock File Preview</summary>
            <pre>{{ initial.previewText || '// empty' }}</pre>
          </details>
        </section>
      </div>
    </div>
  </div>
</template>
