import type { ParsedCliOutput } from '../runner/build'

export type CliOutputView = {
  title: string
  commandLine: string
  cwd: string
  exitCode: number | null
  durationMs: number
  parsed: ParsedCliOutput
}

export function renderCliOutputHtml(view: CliOutputView): string {
  const { parsed } = view
  const summary = [
    parsed.stats.files !== undefined ? `files: ${parsed.stats.files}` : '',
    parsed.stats.routes !== undefined ? `routes: ${parsed.stats.routes}` : '',
    `warnings: ${parsed.warnings.length}`,
    `errors: ${parsed.errors.length}`,
  ].filter(Boolean).join(' · ')

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
    .section { margin: 14px 0; }
    .section h2 { font-size: 12px; margin: 0 0 6px; color: #aaa; }
    pre { background: rgba(127,127,127,0.1); padding: 12px; border-radius: 6px; white-space: pre-wrap; word-break: break-word; }
    ul { margin: 0; padding-left: 18px; }
    li { margin: 2px 0; }
  </style>
</head>
<body>
  <h1>${escapeHtml(view.title)}</h1>
  <div class="meta">
    ${escapeHtml(view.commandLine)} · exit=${escapeHtml(String(view.exitCode))} · ${escapeHtml(String(view.durationMs))}ms
  </div>
  <div class="meta">cwd: ${escapeHtml(view.cwd)}</div>
  <div class="section">
    <h2>Summary</h2>
    <div class="meta">${escapeHtml(summary || 'No summary available')}</div>
  </div>
  ${renderListSection('Errors', parsed.errors)}
  ${renderListSection('Warnings', parsed.warnings)}
  ${renderListSection('Notes', parsed.notes)}
  ${renderListSection('Routes', parsed.routes)}
  ${renderListSection('Files', parsed.files)}
  <div class="section">
    <h2>Raw Output</h2>
    <pre>${escapeHtml(parsed.raw || '// empty')}</pre>
  </div>
</body>
</html>`
}

function renderListSection(title: string, items: string[]): string {
  if (!items.length)
    return ''
  const list = items.map(item => `<li>${escapeHtml(item)}</li>`).join('')
  return `<div class="section"><h2>${escapeHtml(title)}</h2><ul>${list}</ul></div>`
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
