export type OpenApiDocument = {
  openapi?: string
  swagger?: string
  info?: {
    title?: string
    version?: string
  }
  paths?: Record<string, any>
  components?: {
    schemas?: Record<string, any>
  }
  servers?: Array<Record<string, any>>
  tags?: Array<Record<string, any>>
}

export type OpenApiLoadResult = {
  doc: OpenApiDocument
  format: 'json' | 'yaml'
  warnings: string[]
}
