import { mapZodSchemas } from './zod-mapper'
import type { DtsParseResult } from './types'

export function parseDtsSource(sourceText: string): DtsParseResult {
  const warnings: string[] = []
  const schemas: Record<string, unknown> = {}

  let ts: typeof import('typescript') | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ts = require('typescript')
  }
  catch {
    warnings.push('TypeScript parser not available; d.ts parsing skipped.')
    return { schemas, warnings }
  }
  if (!ts)
    return { schemas, warnings }

  const source = ts.createSourceFile('types.d.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const ctx = createSchemaContext(ts, warnings)

  source.forEachChild((node) => {
    if (ts!.isInterfaceDeclaration(node)) {
      const schema = schemaFromInterface(node, ctx)
      if (schema)
        ctx.namedSchemas.set(node.name.text, schema)
    }
    if (ts!.isTypeAliasDeclaration(node)) {
      const schema = schemaFromTypeNode(node.type, ctx)
      if (schema)
        ctx.namedSchemas.set(node.name.text, schema)
    }
  })

  const zodSchemas = mapZodSchemas(sourceText)
  for (const [name, schema] of Object.entries(zodSchemas)) {
    schemas[name] = schema
    ctx.namedSchemas.delete(name)
  }

  for (const [name, schema] of ctx.namedSchemas.entries())
    schemas[name] = schema

  if (Object.keys(schemas).length === 0)
    warnings.push('No schemas parsed from d.ts.')

  return { schemas, warnings }
}

type SchemaContext = {
  ts: typeof import('typescript')
  warnings: string[]
  namedSchemas: Map<string, unknown>
}

function createSchemaContext(ts: typeof import('typescript'), warnings: string[]): SchemaContext {
  return {
    ts,
    warnings,
    namedSchemas: new Map(),
  }
}

function schemaFromInterface(
  node: import('typescript').InterfaceDeclaration,
  ctx: SchemaContext,
): Record<string, unknown> | null {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const member of node.members) {
    if (!ctx.ts.isPropertySignature(member) || !member.type || !member.name)
      continue
    const key = propertyNameText(member.name, ctx.ts)
    if (!key)
      continue
    const schema = schemaFromTypeNode(member.type, ctx)
    if (!schema)
      continue
    properties[key] = schema
    if (!member.questionToken)
      required.push(key)
  }

  const result: Record<string, unknown> = {
    type: 'object',
    properties,
  }
  if (required.length > 0)
    result.required = required
  return result
}

function schemaFromTypeNode(
  node: import('typescript').TypeNode,
  ctx: SchemaContext,
): Record<string, unknown> | null {
  const ts = ctx.ts

  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword:
      return { type: 'string' }
    case ts.SyntaxKind.NumberKeyword:
      return { type: 'number' }
    case ts.SyntaxKind.BooleanKeyword:
      return { type: 'boolean' }
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
      return {}
    case ts.SyntaxKind.NullKeyword:
      return { type: 'null' }
    case ts.SyntaxKind.ObjectKeyword:
      return { type: 'object' }
  }

  if (ts.isLiteralTypeNode(node)) {
    const literal = node.literal
    if (ts.isStringLiteral(literal))
      return { type: 'string', const: literal.text }
    if (ts.isNumericLiteral(literal))
      return { type: 'number', const: Number(literal.text) }
    if (literal.kind === ts.SyntaxKind.TrueKeyword)
      return { type: 'boolean', const: true }
    if (literal.kind === ts.SyntaxKind.FalseKeyword)
      return { type: 'boolean', const: false }
  }

  if (ts.isArrayTypeNode(node)) {
    const items = schemaFromTypeNode(node.elementType, ctx) ?? {}
    return { type: 'array', items }
  }

  if (ts.isTupleTypeNode(node)) {
    const items = node.elements.map(el => schemaFromTypeNode(el, ctx) ?? {})
    return {
      type: 'array',
      items,
      minItems: items.length,
      maxItems: items.length,
    }
  }

  if (ts.isUnionTypeNode(node)) {
    const oneOf = node.types.map(typeNode => schemaFromTypeNode(typeNode, ctx) ?? {})
    return { oneOf }
  }

  if (ts.isIntersectionTypeNode(node)) {
    const allOf = node.types.map(typeNode => schemaFromTypeNode(typeNode, ctx) ?? {})
    return { allOf }
  }

  if (ts.isTypeLiteralNode(node)) {
    const synthetic = ctx.ts.factory.createInterfaceDeclaration(
      undefined,
      ctx.ts.factory.createIdentifier('_'),
      undefined,
      undefined,
      node.members,
    )
    return schemaFromInterface(synthetic, ctx)
  }

  if (ts.isTypeReferenceNode(node)) {
    const refName = node.typeName.getText()
    if (refName === 'Array' || refName === 'ReadonlyArray') {
      const typeArg = node.typeArguments?.[0]
      const items = typeArg ? schemaFromTypeNode(typeArg, ctx) ?? {} : {}
      return { type: 'array', items }
    }
    if (refName === 'Record') {
      const valueType = node.typeArguments?.[1]
      const additionalProperties = valueType ? schemaFromTypeNode(valueType, ctx) ?? {} : {}
      return { type: 'object', additionalProperties }
    }

    const existing = ctx.namedSchemas.get(refName)
    if (existing)
      return { $ref: `#/components/schemas/${refName}` }
  }

  ctx.warnings.push(`Unsupported type node: ${node.getText()}`)
  return {}
}

function propertyNameText(name: import('typescript').PropertyName, ts: typeof import('typescript')): string | null {
  if (ts.isIdentifier(name))
    return name.text
  if (ts.isStringLiteral(name))
    return name.text
  if (ts.isNumericLiteral(name))
    return name.text
  return null
}
