import type { MokupEntry } from '../scan/entries'
import type { MokupRoute } from '../openapi/mapper'
import type { MockWriteOptions, MockWritePlan, WriteMockResult } from '../openapi/plan'
import { renderTemplate, routeToFilePath } from '../openapi/plan'

export type DtsMockOptions = MockWriteOptions & {
  method?: string
  basePath?: string
}

export function planMockWritesForSchemas(
  schemas: Record<string, unknown>,
  entry: MokupEntry,
  packageRoot: string,
  options: DtsMockOptions = {},
): WriteMockResult {
  const warnings: string[] = []
  const files: MockWritePlan[] = []
  const seen = new Set<string>()
  const format = options.format ?? 'ts'
  const tsTemplate = options.tsTemplate
  const jsonTemplate = options.jsonTemplate
  const method = (options.method ?? 'get').toLowerCase()
  const basePath = normalizeBasePath(options.basePath ?? '/schema')

  for (const [name, schema] of Object.entries(schemas)) {
    const route: MokupRoute = {
      method,
      path: `${basePath}/${name}`,
    }
    const filePath = routeToFilePath(route, entry, packageRoot, warnings, format)
    if (!filePath)
      continue
    if (seen.has(filePath)) {
      warnings.push(`Duplicate mock path for schema ${name}`)
      continue
    }
    seen.add(filePath)
    files.push({
      path: filePath,
      content: format === 'ts'
        ? buildSchemaMockTs(route, name, schema, tsTemplate)
        : buildSchemaMockJson(route, name, schema, jsonTemplate),
      format,
    })
  }

  return { files, warnings }
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed)
    return '/schema'
  return trimmed.startsWith('/') ? trimmed.replace(/\/+$/, '') : `/${trimmed.replace(/\/+$/, '')}`
}

function buildSchemaMockJson(route: MokupRoute, name: string, schema: unknown, template?: string): string {
  const payload = {
    ok: true,
    schema: name,
    definition: schema,
  }
  const json = JSON.stringify(payload, null, 2)
  if (template) {
    return renderTemplate(template, route, json, {
      schemaName: name,
      schemaJson: JSON.stringify(schema, null, 2),
    })
  }
  return `${json}\n`
}

function buildSchemaMockTs(route: MokupRoute, name: string, schema: unknown, template?: string): string {
  const schemaText = JSON.stringify(schema, null, 2)
  if (template) {
    return renderTemplate(template, route, undefined, {
      schemaName: name,
      schemaJson: schemaText,
    })
  }
  const schemaLines = schemaText.split('\n')
  schemaLines[schemaLines.length - 1] = `${schemaLines[schemaLines.length - 1]};`
  const lines = [
    "import { defineHandler } from 'mokup'",
    '',
    `const schema = ${schemaLines[0]}`,
    ...schemaLines.slice(1),
    '',
    'export default defineHandler(() => ({',
    '  ok: true,',
    `  schema: '${name}',`,
    '  definition: schema,',
    '}))',
    '',
  ]
  return lines.join('\n')
}
