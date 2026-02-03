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

export type RequestPreviewOptions = {
  cspSource: string
  baseUrl?: string
  instanceLabel?: string
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

export function renderRequestPreviewHtml(route: MockRoute, raw: string, options: RequestPreviewOptions): string {
  const preview = buildPreview(route, raw)
  const title = `${route.method.toUpperCase()} ${route.path}`
  const escaped = escapeHtml(preview.text || '// empty')
  const source = escapeHtml(route.sourceFile)
  const meta = escapeHtml(preview.meta)
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
  })

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${options.cspSource} data:; style-src ${options.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f1e7;
      --bg-2: #efe6d8;
      --card: #ffffff;
      --text: #1b1a17;
      --muted: #6a5d4e;
      --line: rgba(60, 50, 40, 0.16);
      --accent: #1f6f5f;
      --accent-2: #d7a86e;
      --danger: #b03a2e;
      --mono: "JetBrains Mono", "Cascadia Code", "Fira Code", "SFMono-Regular", Menlo, Consolas, monospace;
      --sans: "Space Grotesk", "Segoe UI Variable", "Segoe UI", "Helvetica Neue", sans-serif;
      --shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
      --radius: 16px;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f0f0d;
        --bg-2: #1b1a17;
        --card: #141311;
        --text: #f4f1ea;
        --muted: #b5ab9a;
        --line: rgba(255, 255, 255, 0.12);
        --accent: #62c3a5;
        --accent-2: #f0b26d;
        --danger: #ff6b57;
        --shadow: 0 12px 28px rgba(0, 0, 0, 0.4);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--sans);
      color: var(--text);
      background:
        radial-gradient(1200px 600px at 10% -10%, rgba(215, 168, 110, 0.25), transparent),
        radial-gradient(800px 480px at 100% 0%, rgba(31, 111, 95, 0.22), transparent),
        linear-gradient(135deg, var(--bg), var(--bg-2));
      min-height: 100vh;
    }
    .page {
      padding: 20px 20px 32px;
      max-width: 1200px;
      margin: 0 auto;
    }
    header {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 18px;
    }
    .title {
      font-size: 18px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .meta {
      color: var(--muted);
      font-size: 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .tag {
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(31, 111, 95, 0.12);
      color: var(--accent);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      align-items: start;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 16px;
    }
    .card h2 {
      margin: 0 0 12px;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .field {
      display: grid;
      gap: 6px;
      margin-bottom: 12px;
    }
    label {
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    input, textarea {
      width: 100%;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: transparent;
      color: var(--text);
      padding: 8px 10px;
      font-family: var(--mono);
      font-size: 12px;
    }
    textarea {
      min-height: 84px;
      resize: vertical;
    }
    .hint {
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 12px;
    }
    select {
      width: 100%;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: transparent;
      color: var(--text);
      padding: 8px 10px;
      font-family: var(--mono);
      font-size: 12px;
    }
    .error {
      color: var(--danger);
      font-size: 12px;
      min-height: 16px;
    }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 10px 16px;
      border-radius: 999px;
      border: none;
      background: linear-gradient(135deg, var(--accent), #0f4c3a);
      color: white;
      font-weight: 600;
      letter-spacing: 0.04em;
      cursor: pointer;
    }
    .button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .response-meta {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      font-size: 12px;
      margin-bottom: 10px;
      color: var(--muted);
    }
    pre {
      margin: 0;
      font-family: var(--mono);
      font-size: 12px;
      background: rgba(127, 127, 127, 0.08);
      padding: 12px;
      border-radius: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      border: 1px dashed var(--line);
    }
    details summary {
      cursor: pointer;
      font-size: 12px;
      color: var(--muted);
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-bottom: 12px;
    }
    .resolved {
      font-family: var(--mono);
      font-size: 12px;
      padding: 8px 10px;
      border-radius: 12px;
      border: 1px dashed var(--line);
      background: rgba(127, 127, 127, 0.06);
      word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="page">
    <header>
      <div class="title">${title}</div>
      <div class="meta">
        <span class="tag">${route.method.toUpperCase()}</span>
        <span>${source}</span>
        <span>· ${meta}</span>
      </div>
    </header>

    <div class="grid">
      <section class="card">
        <h2>请求参数</h2>
        <div class="hint">${escapeHtml(note)}</div>
        <div class="field">
          <label for="mode">请求模式</label>
          <select id="mode">
            <option value="online">自动启动 / 在线请求</option>
            <option value="offline">离线模拟（不启动服务）</option>
          </select>
        </div>
        <div class="field">
          <label for="baseUrl">Base URL</label>
          <input id="baseUrl" type="text" placeholder="http://localhost:3000" />
          <div class="error" id="error-baseUrl"></div>
        </div>
        <div class="field">
          <label>路径</label>
          <div class="resolved" id="pathView"></div>
        </div>
        <div class="field">
          <label for="pathParams">Path Params (JSON)</label>
          <textarea id="pathParams" spellcheck="false" placeholder="{ &quot;id&quot;: 1 }"></textarea>
          <div class="error" id="error-pathParams"></div>
        </div>
        <div class="field">
          <label for="queryParams">Query Params (JSON)</label>
          <textarea id="queryParams" spellcheck="false" placeholder="{ &quot;page&quot;: 1, &quot;size&quot;: 20 }"></textarea>
          <div class="error" id="error-queryParams"></div>
        </div>
        <div class="field">
          <label for="headers">Headers (JSON)</label>
          <textarea id="headers" spellcheck="false" placeholder="{ &quot;Authorization&quot;: &quot;Bearer ...&quot; }"></textarea>
          <div class="error" id="error-headers"></div>
        </div>
        <div class="field">
          <label for="body">Body (JSON)</label>
          <textarea id="body" spellcheck="false" placeholder="{ &quot;name&quot;: &quot;Mokup&quot; }"></textarea>
          <div class="error" id="error-body"></div>
        </div>
        <div class="field">
          <label>Resolved URL</label>
          <div class="resolved" id="resolvedUrl"></div>
        </div>
        <button class="button" id="sendBtn">发送请求</button>
      </section>

      <section class="card">
        <h2>响应结果</h2>
        <div class="response-meta" id="respMeta">
          <span>状态：--</span>
          <span>耗时：--</span>
        </div>
        <div class="field">
          <label>Headers</label>
          <pre id="respHeaders">// empty</pre>
        </div>
        <div class="field">
          <label>Body</label>
          <pre id="respBody">// empty</pre>
        </div>
        <div class="error" id="respError"></div>
      </section>
    </div>

    <details class="card" style="margin-top: 16px;">
      <summary>Mock 文件预览</summary>
      <pre>${escaped}</pre>
    </details>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const state = ${initialState};
    const $ = (id) => document.getElementById(id);
    const baseUrl = $('baseUrl');
    const mode = $('mode');
    const pathView = $('pathView');
    const pathParams = $('pathParams');
    const queryParams = $('queryParams');
    const headers = $('headers');
    const body = $('body');
    const resolvedUrl = $('resolvedUrl');
    const sendBtn = $('sendBtn');
    const respMeta = $('respMeta');
    const respHeaders = $('respHeaders');
    const respBody = $('respBody');
    const respError = $('respError');

    const errorBaseUrl = $('error-baseUrl');
    const errorPathParams = $('error-pathParams');
    const errorQueryParams = $('error-queryParams');
    const errorHeaders = $('error-headers');
    const errorBody = $('error-body');

    baseUrl.value = state.baseUrl || '';
    pathView.textContent = state.method + ' ' + state.path;

    let lastRequestId = '';
    let pendingEnsure = false;

    function parseJsonField(value, errorEl) {
      const text = value.trim();
      if (!text) {
        errorEl.textContent = '';
        return { ok: true, value: {} };
      }
      try {
        const parsed = JSON.parse(text);
        errorEl.textContent = '';
        return { ok: true, value: parsed };
      } catch (error) {
        errorEl.textContent = 'JSON 解析失败';
        return { ok: false };
      }
    }

    function buildPath(template, params) {
      return template.replace(/\\{([^}]+)\\}/g, (raw, key) => {
        const value = params && Object.prototype.hasOwnProperty.call(params, key) ? params[key] : undefined;
        if (value === undefined || value === null || value === '')
          return raw;
        return encodeURIComponent(String(value));
      });
    }

    function resolveTemplateValue(expr, context) {
      const tokens = [];
      const re = /([A-Za-z_$][\\w$]*)|\\[(?:\"([^\"]+)\"|'([^']+)'|([^\\]]+))\\]/g;
      let match;
      while ((match = re.exec(expr))) {
        const token = match[1] || match[2] || match[3] || match[4];
        if (token != null && token !== '')
          tokens.push(token.trim());
      }
      if (!tokens.length)
        return undefined;
      let current = context;
      for (const token of tokens) {
        if (current == null)
          return undefined;
        if (typeof current === 'object' || Array.isArray(current)) {
          if (Object.prototype.hasOwnProperty.call(current, token)) {
            current = current[token];
            continue;
          }
          const index = Number(token);
          if (Array.isArray(current) && !Number.isNaN(index)) {
            current = current[index];
            continue;
          }
          return undefined;
        }
        return undefined;
      }
      return current;
    }

    function replaceTemplatesInString(text, context) {
      if (!text)
        return text;
      return text.replace(/\\$\\{([^}]+)\\}|\\{\\{([^}]+)\\}\\}/g, (raw, exprA, exprB) => {
        const expr = (exprA || exprB || '').trim();
        if (!expr)
          return raw;
        const value = resolveTemplateValue(expr, context);
        if (value === undefined)
          return raw;
        if (value === null)
          return 'null';
        if (typeof value === 'object')
          return JSON.stringify(value);
        return String(value);
      });
    }

    function resolveWholePlaceholder(text, context) {
      if (!text)
        return undefined;
      const trimmed = text.trim();
      const bracketMatch = trimmed.match(/^<([^>]+)>$/);
      if (bracketMatch) {
        const expr = bracketMatch[1].trim();
        const roots = ['body', 'query', 'params', 'headers'];
        for (const root of roots) {
          const value = resolveTemplateValue(root + '.' + expr, context);
          if (value !== undefined)
            return value;
        }
        return resolveTemplateValue(expr, context);
      }
      const tplMatch = trimmed.match(/^\\$\\{([^}]+)\\}$|^\\{\\{([^}]+)\\}\\}$/);
      if (tplMatch) {
        const expr = (tplMatch[1] || tplMatch[2] || '').trim();
        if (!expr)
          return undefined;
        const value = resolveTemplateValue(expr, context);
        if (value !== undefined)
          return value;
      }
      return undefined;
    }

    function applyTemplates(value, context) {
      if (typeof value === 'string') {
        const whole = resolveWholePlaceholder(value, context);
        if (whole !== undefined)
          return whole;
        return replaceTemplatesInString(value, context);
      }
      if (Array.isArray(value))
        return value.map(item => applyTemplates(item, context));
      if (value && typeof value === 'object') {
        const result = {};
        for (const [key, val] of Object.entries(value)) {
          const nextKey = replaceTemplatesInString(key, context);
          result[nextKey] = applyTemplates(val, context);
        }
        return result;
      }
      return value;
    }

    function buildQuery(obj) {
      if (!obj || typeof obj !== 'object')
        return '';
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(obj)) {
        if (Array.isArray(value)) {
          for (const item of value)
            params.append(key, item == null ? '' : String(item));
          continue;
        }
        if (value && typeof value === 'object') {
          params.append(key, JSON.stringify(value));
          continue;
        }
        params.append(key, value == null ? '' : String(value));
      }
      const text = params.toString();
      return text ? '?' + text : '';
    }

    function joinUrl(base, path) {
      const trimmedBase = base.replace(/\\/+$/, '');
      const normalizedPath = path.startsWith('/') ? path : '/' + path;
      return trimmedBase + normalizedPath;
    }

    function updateResolvedUrl() {
      const paramsResult = parseJsonField(pathParams.value, errorPathParams);
      const queryResult = parseJsonField(queryParams.value, errorQueryParams);
      if (!paramsResult.ok || !queryResult.ok) {
        resolvedUrl.textContent = '--';
        return { ok: false };
      }
      const pathValue = buildPath(state.path, paramsResult.value);
      const queryValue = buildQuery(queryResult.value);
      const base = baseUrl.value.trim();
      const url = base ? joinUrl(base, pathValue) + queryValue : pathValue + queryValue;
      resolvedUrl.textContent = url || '--';
      return { ok: true, url };
    }

    baseUrl.addEventListener('input', updateResolvedUrl);
    pathParams.addEventListener('input', updateResolvedUrl);
    queryParams.addEventListener('input', updateResolvedUrl);
    updateResolvedUrl();

    function performRequest() {
      respError.textContent = '';
      const base = baseUrl.value.trim();
      if (!base) {
        errorBaseUrl.textContent = '请填写 Base URL';
        return;
      }
      errorBaseUrl.textContent = '';

      const paramsResult = parseJsonField(pathParams.value, errorPathParams);
      const queryResult = parseJsonField(queryParams.value, errorQueryParams);
      const headerResult = parseJsonField(headers.value, errorHeaders);
      const bodyResult = parseJsonField(body.value, errorBody);
      if (!paramsResult.ok || !queryResult.ok || !headerResult.ok || !bodyResult.ok)
        return;

      const pathValue = buildPath(state.path, paramsResult.value);
      const queryValue = buildQuery(queryResult.value);
      const url = joinUrl(base, pathValue) + queryValue;
      resolvedUrl.textContent = url;

      const headerObj = headerResult.value || {};
      let bodyText = '';
      if (body.value.trim())
        bodyText = JSON.stringify(bodyResult.value);
      const hasContentType = Object.keys(headerObj).some(key => key.toLowerCase() === 'content-type');
      if (bodyText && !hasContentType)
        headerObj['content-type'] = 'application/json';

      lastRequestId = String(Date.now());
      sendBtn.disabled = true;
      respMeta.innerHTML = '<span>状态：请求中...</span><span>耗时：--</span>';
      vscode.postMessage({
        type: 'sendRequest',
        id: lastRequestId,
        payload: {
          method: state.method,
          url,
          headers: headerObj,
          body: bodyText,
        }
      });
    }

    function performOffline() {
      respError.textContent = '';
      errorBaseUrl.textContent = '';

      const paramsResult = parseJsonField(pathParams.value, errorPathParams);
      const queryResult = parseJsonField(queryParams.value, errorQueryParams);
      const headerResult = parseJsonField(headers.value, errorHeaders);
      const bodyResult = parseJsonField(body.value, errorBody);
      if (!paramsResult.ok || !queryResult.ok || !headerResult.ok || !bodyResult.ok)
        return;

      const pathValue = buildPath(state.path, paramsResult.value);
      const queryValue = buildQuery(queryResult.value);
      const base = baseUrl.value.trim();
      const url = base ? joinUrl(base, pathValue) + queryValue : pathValue + queryValue;
      resolvedUrl.textContent = url;

      let previewValue = state.previewText || '';
      try {
        if (typeof previewValue === 'string') {
          const trimmed = previewValue.trim();
          if (trimmed && (trimmed.startsWith('{') || trimmed.startsWith('[')))
            previewValue = JSON.parse(trimmed);
        }
      } catch {}

      const context = {
        params: paramsResult.value || {},
        query: queryResult.value || {},
        headers: headerResult.value || {},
        body: body.value.trim() ? bodyResult.value : {},
      };
      previewValue = applyTemplates(previewValue, context);

      const responsePayload = {
        mode: 'offline',
        request: {
          pathParams: paramsResult.value,
          query: queryResult.value,
          headers: headerResult.value,
          body: body.value.trim() ? bodyResult.value : null,
        },
        preview: previewValue,
      };

      respMeta.innerHTML = '<span>状态：离线模拟</span><span>耗时：0 ms</span>';
      respHeaders.textContent = JSON.stringify({ 'x-mokup-mode': 'offline' }, null, 2);
      respBody.textContent = JSON.stringify(responsePayload, null, 2);
    }

    function ensureBaseUrlAndSend() {
      if (mode.value === 'offline') {
        performOffline();
        return;
      }
      const base = baseUrl.value.trim();
      if (base) {
        performRequest();
        return;
      }
      if (pendingEnsure)
        return;
      pendingEnsure = true;
      sendBtn.disabled = true;
      respMeta.innerHTML = '<span>状态：启动 mock...</span><span>耗时：--</span>';
      vscode.postMessage({ type: 'ensureMock' });
    }

    sendBtn.addEventListener('click', ensureBaseUrlAndSend);

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message && message.type === 'ensureMockResult') {
        pendingEnsure = false;
        sendBtn.disabled = false;
        if (!message.ok) {
          respError.textContent = message.error || '启动 mock 失败';
          respMeta.innerHTML = '<span>状态：失败</span><span>耗时：--</span>';
          return;
        }
        if (message.baseUrl) {
          baseUrl.value = message.baseUrl;
          updateResolvedUrl();
        }
        performRequest();
        return;
      }
      if (!message || message.type !== 'response')
        return;
      if (message.id !== lastRequestId)
        return;
      sendBtn.disabled = false;

      if (!message.ok) {
        respError.textContent = message.error || '请求失败';
        respMeta.innerHTML = '<span>状态：失败</span><span>耗时：' + (message.durationMs ?? '--') + ' ms</span>';
        return;
      }

      const status = message.status ?? '--';
      const statusText = message.statusText ? ' ' + message.statusText : '';
      const duration = message.durationMs ?? '--';
      respMeta.innerHTML = '<span>状态：' + status + statusText + '</span><span>耗时：' + duration + ' ms</span>';
      respHeaders.textContent = message.headers ? JSON.stringify(message.headers, null, 2) : '// empty';

      const bodyText = message.body ?? '';
      const contentType = message.headers && Object.keys(message.headers).find(key => key.toLowerCase() === 'content-type');
      const maybeJson = contentType && message.headers[contentType].includes('application/json');
      if (maybeJson) {
        try {
          respBody.textContent = JSON.stringify(JSON.parse(bodyText), null, 2);
          return;
        } catch {}
      }
      if (bodyText && (bodyText.trim().startsWith('{') || bodyText.trim().startsWith('['))) {
        try {
          respBody.textContent = JSON.stringify(JSON.parse(bodyText), null, 2);
          return;
        } catch {}
      }
      respBody.textContent = bodyText || '// empty';
    });
  </script>
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
