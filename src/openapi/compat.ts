import type { OpenApiDocument } from './types'

export type OpenApiVersion = '3.1' | '3.0' | '2.0' | 'unknown'

export function detectOpenApiVersion(doc: OpenApiDocument): OpenApiVersion {
  if (doc.openapi?.startsWith('3.1'))
    return '3.1'
  if (doc.openapi?.startsWith('3.0'))
    return '3.0'
  if (doc.swagger?.startsWith('2.'))
    return '2.0'
  return 'unknown'
}

export function normalizeOpenApiDocument(doc: OpenApiDocument): { doc: OpenApiDocument, warnings: string[] } {
  const warnings: string[] = []
  const version = detectOpenApiVersion(doc)
  if (version === 'unknown')
    warnings.push('Unknown OpenAPI version.')
  if (version === '2.0')
    warnings.push('Swagger/OpenAPI 2.0 detected; only partial support is planned.')
  return { doc, warnings }
}
