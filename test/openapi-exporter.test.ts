import { describe, expect, it } from 'vitest'
import { exportMokupToOpenApi } from '../src/openapi/exporter'

describe('openapi exporter', () => {
  it('preserves base metadata and maps routes', () => {
    const base = {
      openapi: '3.1.0',
      info: { title: 'Base', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      tags: [{ name: 'users' }],
    }
    const doc = exportMokupToOpenApi({
      base,
      routes: [
        { method: 'get', path: '/users', sourceFile: '' },
        { method: 'post', path: '/users', sourceFile: '' },
      ],
      schemas: { User: { type: 'object' } },
    })

    expect(doc.info?.title).toBe('Base')
    expect((doc as any).servers).toHaveLength(1)
    expect((doc as any).tags).toHaveLength(1)
    expect(doc.paths?.['/users']).toHaveProperty('get')
    expect(doc.paths?.['/users']).toHaveProperty('post')
    expect(doc.components?.schemas).toHaveProperty('User')
  })

  it('merges or overwrites existing paths', () => {
    const base = {
      openapi: '3.1.0',
      info: { title: 'Base', version: '1.0.0' },
      paths: {
        '/users': {
          get: { responses: { 200: { description: 'Base' } } },
        },
      },
    }
    const merged = exportMokupToOpenApi({
      base,
      routes: [{ method: 'get', path: '/users', sourceFile: '' }],
      mergeStrategy: 'merge',
    })
    expect((merged.paths as any)['/users'].get.responses[200].description).toBe('Base')

    const overwritten = exportMokupToOpenApi({
      base,
      routes: [{ method: 'get', path: '/users', sourceFile: '' }],
      mergeStrategy: 'overwrite',
    })
    expect((overwritten.paths as any)['/users'].get.responses[200].description).toBe('OK')
  })
})
