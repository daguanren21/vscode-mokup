import { describe, expect, it } from 'vitest'
import { parseEntriesFromViteConfig } from '../src/scan/entries'

describe('parseEntriesFromViteConfig (AST)', () => {
  it('reads entries from const binding', () => {
    const content = `
      import { defineConfig } from 'vite'
      import { mokup } from 'mokup/vite'

      const entries = [
        { dir: 'mock', prefix: '/api' },
        { dir: 'mock/admin' },
      ]

      export default defineConfig({
        plugins: [mokup({ entries })],
      })
    `

    const result = parseEntriesFromViteConfig(content)
    expect(result.entries.length).toBe(2)
    expect(result.entries[0]).toMatchObject({ dir: 'mock', prefix: '/api' })
  })

  it('expands dir array in entry', () => {
    const content = `
      export default {
        plugins: [mokup({ entries: { dir: ['mock', 'mock-extra'], prefix: '/api' } })],
      }
    `
    const result = parseEntriesFromViteConfig(content)
    expect(result.entries.length).toBe(2)
  })

  it('handles path.resolve in entries', () => {
    const content = `
      import path from 'node:path'
      export default {
        plugins: [mokup({ entries: { dir: path.resolve('mock') } })],
      }
    `
    const result = parseEntriesFromViteConfig(content)
    expect(result.entries.length).toBe(1)
  })
})
