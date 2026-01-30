import path from 'node:path'
import type { MokupEntry } from '../scan/entries'
import type { MokupRoute } from './mapper'

export type MockWritePlan = {
  path: string
  content: string
  format: 'ts' | 'json'
}

export type WriteMockResult = {
  files: MockWritePlan[]
  warnings: string[]
}

export type MockWriteOptions = {
  format?: 'ts' | 'json'
  tsTemplate?: string
  jsonTemplate?: string
}

export function planMockWritesForEntry(
  routes: MokupRoute[],
  entry: MokupEntry,
  packageRoot: string,
  options: MockWriteOptions = {},
): WriteMockResult {
  const warnings: string[] = []
  const files: MockWritePlan[] = []
  const seen = new Set<string>()
  const format = options.format ?? 'ts'
  const tsTemplate = options.tsTemplate
  const jsonTemplate = options.jsonTemplate

  for (const route of routes) {
    const filePath = routeToFilePath(route, entry, packageRoot, warnings, format)
    if (!filePath)
      continue
    if (seen.has(filePath)) {
      warnings.push(`Duplicate mock path for ${route.method.toUpperCase()} ${route.path}`)
      continue
    }
    seen.add(filePath)
    files.push({
      path: filePath,
      content: format === 'ts'
        ? buildMockTs(route, tsTemplate)
        : buildMockJson(route, jsonTemplate),
      format,
    })
  }

  return { files, warnings }
}

export function routeToFilePath(
  route: MokupRoute,
  entry: MokupEntry,
  packageRoot: string,
  warnings: string[],
  format: 'ts' | 'json',
): string | null {
  const dir = entry.dir
  if (!dir) {
    warnings.push(`Missing entry dir for route ${route.method.toUpperCase()} ${route.path}`)
    return null
  }

  const normalized = normalizePath(route.path, entry.prefix)
  const segments = splitRouteSegments(normalized)
  if (segments.length === 0)
    segments.push('index')

  const method = route.method.toLowerCase()
  const ext = format === 'json' ? 'json' : 'ts'
  const fileName = `${segments.pop()}.${method}.${ext}`
  const filePath = path.join(packageRoot, dir, ...segments, fileName)
  return filePath
}

function normalizePath(routePath: string, prefix?: string): string {
  let pathValue = routePath.trim()
  if (!pathValue.startsWith('/'))
    pathValue = `/${pathValue}`
  if (prefix) {
    const normalizedPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`
    if (pathValue.startsWith(normalizedPrefix))
      pathValue = pathValue.slice(normalizedPrefix.length) || '/'
  }
  return pathValue
}

function splitRouteSegments(routePath: string): string[] {
  const cleaned = routePath.replace(/\/+$/, '')
  if (!cleaned || cleaned === '/')
    return ['index']
  const segments = cleaned.split('/').filter(Boolean)
  return segments.map(seg => seg.replace(/^\{(.+)\}$/, '[$1]'))
}

function buildMockJson(route: MokupRoute, template?: string): string {
  const payload = {
    ok: true,
    method: route.method.toUpperCase(),
    path: route.path,
  }
  const json = JSON.stringify(payload, null, 2)
  if (template)
    return renderTemplate(template, route, json)
  return `${json}\n`
}

function buildMockTs(route: MokupRoute, template?: string): string {
  const method = route.method.toUpperCase()
  const path = route.path
  const withBody = ['POST', 'PUT', 'PATCH'].includes(method)
  const bodyReturn = withBody ? ',\n    body' : ''
  if (template) {
    return renderTemplate(template, route, undefined, {
      body: withBody ? '  const body = await c.req.json().catch(() => ({}))' : '',
      bodyReturn,
    })
  }
  const lines = [
    "import { defineHandler } from 'mokup'",
    '',
    `export default defineHandler(async (c) => {`,
  ]
  if (withBody)
    lines.push('  const body = await c.req.json().catch(() => ({}))')
  lines.push(
    '  return {',
    '    ok: true,',
    `    method: '${method}',`,
    `    path: '${path}'${bodyReturn}`,
    '  }',
    '})',
    '',
  )
  return lines.join('\n')
}

export function renderTemplate(
  template: string,
  route: MokupRoute,
  json?: string,
  extras?: { body?: string, bodyReturn?: string, schemaName?: string, schemaJson?: string },
): string {
  const methodUpper = route.method.toUpperCase()
  const methodLower = route.method.toLowerCase()
  const body = extras?.body ?? ''
  const bodyReturn = extras?.bodyReturn ?? ''
  const schemaName = extras?.schemaName ?? ''
  const schemaJson = extras?.schemaJson ?? ''
  const pathBase = stripPathParams(route.path)
  const pathRaw = route.path
  const params = extractParams(route.path)
  const paramsJson = JSON.stringify(Object.fromEntries(params.map(p => [p, `{${p}}`])), null, 2)

  return template
    .replace(/\{\{method\}\}/g, methodUpper)
    .replace(/\{\{methodLower\}\}/g, methodLower)
    .replace(/\{\{path\}\}/g, pathBase)
    .replace(/\{\{pathRaw\}\}/g, pathRaw)
    .replace(/\{\{params\}\}/g, paramsJson)
    .replace(/\{\{paramsList\}\}/g, params.join(', '))
    .replace(/\{\{query\}\}/g, '{}')
    .replace(/\{\{body\}\}/g, body)
    .replace(/\{\{bodyReturn\}\}/g, bodyReturn)
    .replace(/\{\{schemaName\}\}/g, schemaName)
    .replace(/\{\{schemaJson\}\}/g, schemaJson)
    .replace(/\{\{json\}\}/g, json ?? '')
    .trimEnd()
    .concat('\n')
}

function extractParams(pathValue: string): string[] {
  const results: string[] = []
  const re = /\{([^}]+)\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(pathValue))) {
    if (match[1])
      results.push(match[1])
  }
  return results
}

function stripPathParams(pathValue: string): string {
  const cleaned = pathValue.trim() || '/'
  const segments = cleaned.split('/').filter(Boolean)
  const filtered = segments.filter(seg => !/^\{[^}]+\}$/.test(seg))
  const joined = `/${filtered.join('/')}`
  return joined === '/' ? '/' : joined.replace(/\/+$/, '')
}
