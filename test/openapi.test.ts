import { describe, expect, it } from 'vitest'
import { detectOpenApiVersion } from '../src/openapi/compat'
import { mapOpenApiToMokup } from '../src/openapi/mapper'

describe('openapi compat', () => {
  it('detects openapi 3.1', () => {
    expect(detectOpenApiVersion({ openapi: '3.1.0' })).toBe('3.1')
  })

  it('detects openapi 3.0', () => {
    expect(detectOpenApiVersion({ openapi: '3.0.3' })).toBe('3.0')
  })

  it('detects swagger 2.0', () => {
    expect(detectOpenApiVersion({ swagger: '2.0' })).toBe('2.0')
  })
})

describe('openapi mapper', () => {
  it('maps paths and schemas', () => {
    const doc = {
      openapi: '3.1.0',
      paths: {
        '/users': {
          get: {},
          post: {},
          parameters: [],
        },
        '/users/{id}': {
          delete: {},
          patch: {},
        },
      },
      components: {
        schemas: {
          User: { type: 'object' },
          Error: { type: 'object' },
        },
      },
    }

    const result = mapOpenApiToMokup(doc)
    expect(result.routes).toHaveLength(4)
    expect(result.schemas).toHaveProperty('User')
    expect(result.schemas).toHaveProperty('Error')
  })
})
