import type { OpenApiDocument } from './types'
import type { MockRoute } from '../mock/routes'

export type ExportOpenApiOptions = {
  title?: string
  version?: string
  base?: OpenApiDocument
  routes?: MockRoute[]
  schemas?: Record<string, unknown>
  mergeStrategy?: 'merge' | 'overwrite'
}

export function exportMokupToOpenApi(options?: ExportOpenApiOptions): OpenApiDocument {
  const base = options?.base
  const mergeStrategy = options?.mergeStrategy ?? 'merge'
  const doc: OpenApiDocument = {
    openapi: base?.openapi ?? '3.1.0',
    info: base?.info ?? {
      title: options?.title ?? 'Mokup API',
      version: options?.version ?? '0.0.0',
    },
    paths: {},
    components: {
      schemas: {},
    },
  }

  if (base?.servers)
    (doc as any).servers = base.servers
  if (base?.tags)
    (doc as any).tags = base.tags

  const routes = options?.routes ?? []
  doc.paths = mergePaths(base?.paths, routes, mergeStrategy)

  const schemas = options?.schemas ?? {}
  doc.components = doc.components ?? {}
  doc.components.schemas = mergeSchemas(base?.components?.schemas, schemas, mergeStrategy)

  return doc
}

function mergePaths(
  basePaths: OpenApiDocument['paths'] | undefined,
  routes: MockRoute[],
  strategy: 'merge' | 'overwrite',
): Record<string, any> {
  const result: Record<string, any> = { ...(basePaths ?? {}) }
  for (const route of routes) {
    const existing = result[route.path] ?? {}
    const already = existing[route.method]
    if (already && strategy === 'merge')
      continue
    existing[route.method] = strategy === 'overwrite'
      ? {
          responses: {
            200: { description: 'OK' },
          },
        }
      : already ?? {
          responses: {
            200: { description: 'OK' },
          },
        }
    result[route.path] = existing
  }
  return result
}

function mergeSchemas(
  baseSchemas: Record<string, unknown> | undefined,
  schemas: Record<string, unknown>,
  strategy: 'merge' | 'overwrite',
): Record<string, unknown> {
  if (!baseSchemas)
    return { ...schemas }
  if (strategy === 'overwrite')
    return { ...baseSchemas, ...schemas }

  const merged: Record<string, unknown> = { ...baseSchemas }
  for (const [key, schema] of Object.entries(schemas)) {
    if (!(key in merged))
      merged[key] = schema
  }
  return merged
}
