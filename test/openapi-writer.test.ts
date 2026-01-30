import { describe, expect, it } from 'vitest'
import type { MokupEntry } from '../src/scan/entries'
import { planMockWritesForEntry } from '../src/openapi/plan'

describe('openapi writer', () => {
  it('maps routes to mokup file paths', () => {
    const entry: MokupEntry = { dir: 'mock', prefix: '/api' }
    const plan = planMockWritesForEntry([
      { method: 'get', path: '/api/users' },
      { method: 'post', path: '/api/users/{id}' },
      { method: 'get', path: '/' },
    ], entry, '/repo')

    const paths = plan.files.map(file => file.path.replace(/\\/g, '/'))
    expect(paths).toContain('/repo/mock/users.get.ts')
    expect(paths).toContain('/repo/mock/users/[id].post.ts')
    expect(paths).toContain('/repo/mock/index.get.ts')
    expect(plan.files[0].content).toContain('defineHandler')
  })

  it('supports json format output', () => {
    const entry: MokupEntry = { dir: 'mock' }
    const plan = planMockWritesForEntry([
      { method: 'get', path: '/api/users' },
    ], entry, '/repo', { format: 'json' })

    expect(plan.files[0].path.replace(/\\/g, '/')).toContain('/repo/mock/api/users.get.json')
    expect(plan.files[0].content.trim().startsWith('{')).toBe(true)
  })

  it('applies custom templates', () => {
    const entry: MokupEntry = { dir: 'mock' }
    const plan = planMockWritesForEntry([
      { method: 'post', path: '/api/users/{id}' },
    ], entry, '/repo', {
      format: 'ts',
      tsTemplate: 'METHOD={{method}} methodLower={{methodLower}} path={{path}} params={{paramsList}}\n{{body}}\nRETURN{{bodyReturn}}',
    })
    const content = plan.files[0].content
    expect(content).toContain('METHOD=POST')
    expect(content).toContain('methodLower=post')
    expect(content).toContain('path=/api/users')
    expect(content).toContain('params=id')
  })
})
