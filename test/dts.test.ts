import { describe, expect, it } from 'vitest'
import { parseDtsSource } from '../src/dts/parse-source'
import { mapZodSchemas } from '../src/dts/zod-mapper'

describe('dts parser', () => {
  it('parses interface and type alias', () => {
    const source = `
      export interface User {
        id: string
        name?: string
      }

      export type Role = 'admin' | 'user'
    `
    const result = parseDtsSource(source)
    expect(result.schemas).toHaveProperty('User')
    expect(result.schemas).toHaveProperty('Role')
  })
})

describe('zod mapper', () => {
  it('parses zod object with optional field', () => {
    const source = `
      import { z } from 'zod'
      const User = z.object({
        id: z.string(),
        name: z.string().optional(),
      })
    `
    const schemas = mapZodSchemas(source)
    expect(schemas).toHaveProperty('User')
    const user = schemas.User as { required?: string[] }
    expect(user.required).toContain('id')
    expect(user.required).not.toContain('name')
  })

  it('parses record/tuple/extend/merge', () => {
    const source = `
      import { z } from 'zod'
      const Base = z.object({
        id: z.string(),
      })
      const Extended = Base.extend({
        name: z.string().optional(),
      })
      const Merged = Base.merge(z.object({
        age: z.number(),
      }))
      const Tupled = z.tuple([z.string(), z.number()])
      const Recorded = z.record(z.string())
    `
    const schemas = mapZodSchemas(source)
    expect(schemas).toHaveProperty('Extended')
    expect(schemas).toHaveProperty('Merged')
    expect(schemas).toHaveProperty('Tupled')
    expect(schemas).toHaveProperty('Recorded')
  })

  it('parses discriminatedUnion and pipe', () => {
    const source = `
      import { z } from 'zod'
      const Foo = z.object({ type: z.literal('foo'), value: z.string() })
      const Bar = z.object({ type: z.literal('bar'), value: z.number() })
      const Discriminated = z.discriminatedUnion('type', [Foo, Bar])
      const Piped = z.string().pipe(z.number())
    `
    const schemas = mapZodSchemas(source)
    expect(schemas).toHaveProperty('Discriminated')
    expect(schemas).toHaveProperty('Piped')
  })

  it('parses coerce/date/describe/brand', () => {
    const source = `
      import { z } from 'zod'
      const Coerced = z.coerce.number()
      const Dated = z.date()
      const Branded = z.string().brand('UserId')
      const Described = z.string().describe('desc')
    `
    const schemas = mapZodSchemas(source)
    expect(schemas).toHaveProperty('Coerced')
    expect(schemas).toHaveProperty('Dated')
    expect(schemas).toHaveProperty('Branded')
    expect(schemas).toHaveProperty('Described')
  })
})
