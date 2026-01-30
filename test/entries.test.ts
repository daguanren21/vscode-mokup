import { describe, expect, it } from 'vitest'
import { parseEntriesFromViteConfig } from '../src/scan/entries'

describe('parseEntriesFromViteConfig', () => {
  it('parses entries from mokup plugin call', () => {
    const content = `
      import { defineConfig } from 'vite'
      import { mokup } from 'mokup/vite'

      export default defineConfig({
        plugins: [
          mokup({
            entries: [
              { dir: 'mock', prefix: '/api', watch: true, mode: 'server' },
              { dir: 'mocks/user' }
            ]
          })
        ]
      })
    `
    const result = parseEntriesFromViteConfig(content)
    expect(result.entries.length).toBe(2)
    expect(result.entries[0]).toMatchObject({
      dir: 'mock',
      prefix: '/api',
      watch: true,
      mode: 'server',
    })
    expect(result.entries[1]).toMatchObject({
      dir: 'mocks/user',
    })
  })

  it('parses entries from fallback entries field', () => {
    const content = `
      export default {
        entries: { dir: 'mock', prefix: '/api' }
      }
    `
    const result = parseEntriesFromViteConfig(content)
    expect(result.entries.length).toBe(1)
    expect(result.entries[0]).toMatchObject({
      dir: 'mock',
      prefix: '/api',
    })
  })

  it('warns on dynamic entries', () => {
    const content = `
      export default {
        entries: getEntries()
      }
    `
    const result = parseEntriesFromViteConfig(content)
    expect(result.entries.length).toBe(0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})
