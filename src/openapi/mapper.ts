import type { OpenApiDocument } from './types'

export type MokupSchemaMap = Record<string, unknown>
export type MokupRoute = {
  method: string
  path: string
}

export type OpenApiMapResult = {
  routes: MokupRoute[]
  schemas: MokupSchemaMap
  warnings: string[]
}

export function mapOpenApiToMokup(doc: OpenApiDocument): OpenApiMapResult {
  const warnings: string[] = []
  const routes: MokupRoute[] = []
  const schemas: MokupSchemaMap = {}

  if (!doc.paths)
    warnings.push('OpenAPI paths not found.')
  else {
    const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'])
    for (const [path, def] of Object.entries(doc.paths)) {
      if (!def || typeof def !== 'object')
        continue
      for (const [method, _operation] of Object.entries(def)) {
        if (!methods.has(method))
          continue
        routes.push({
          method,
          path,
        })
      }
    }
  }

  if (doc.components?.schemas && typeof doc.components.schemas === 'object') {
    for (const [name, schema] of Object.entries(doc.components.schemas))
      schemas[name] = schema
  }

  return { routes, schemas, warnings }
}
