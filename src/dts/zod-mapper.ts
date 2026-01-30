export type ZodSchemaMap = Record<string, unknown>

type SchemaWithFlags = {
  schema: Record<string, unknown>
  optional?: boolean
}

export function mapZodSchemas(source: string): ZodSchemaMap {
  let ts: typeof import('typescript') | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ts = require('typescript')
  }
  catch {
    return {}
  }
  if (!ts)
    return {}

  const sourceFile = ts.createSourceFile('zod.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const schemas: ZodSchemaMap = {}
  const env = new Map<string, SchemaWithFlags>()

  sourceFile.forEachChild((node) => {
    if (!ts!.isVariableStatement(node))
      return
    for (const decl of node.declarationList.declarations) {
      if (!ts!.isIdentifier(decl.name) || !decl.initializer)
        continue
      const parsed = schemaFromZodExpression(decl.initializer, ts!, env)
      if (parsed?.schema) {
        schemas[decl.name.text] = parsed.schema
        env.set(decl.name.text, parsed)
      }
    }
  })

  return schemas
}

function schemaFromZodExpression(
  node: import('typescript').Expression,
  ts: typeof import('typescript'),
  env?: Map<string, SchemaWithFlags>,
): SchemaWithFlags | null {
  if (ts.isIdentifier(node) && env?.has(node.text))
    return env.get(node.text) ?? null

  if (!ts.isCallExpression(node))
    return null

  const callee = node.expression
  if (ts.isPropertyAccessExpression(callee)) {
    const method = callee.name.text
    const target = callee.expression

    if (method === 'optional' || method === 'nullable') {
      const base = schemaFromZodExpression(target as import('typescript').Expression, ts, env)
      if (!base)
        return null
      if (method === 'optional')
        return { schema: base.schema, optional: true }
      if (method === 'nullable') {
        return { schema: { anyOf: [base.schema, { type: 'null' }] } }
      }
    }

    if (method === 'nullish') {
      const base = schemaFromZodExpression(target as import('typescript').Expression, ts, env)
      if (!base)
        return null
      return { schema: { anyOf: [base.schema, { type: 'null' }] }, optional: true }
    }

    if (method === 'extend') {
      const base = schemaFromZodExpression(target as import('typescript').Expression, ts, env)
      const extension = node.arguments[0]
      if (!base || !extension || !ts.isObjectLiteralExpression(extension))
        return base ?? null
      const extra = schemaFromZodObjectShape(extension, ts, env)
      return mergeObjectSchemas(base, extra)
    }

    if (method === 'merge') {
      const base = schemaFromZodExpression(target as import('typescript').Expression, ts, env)
      const otherExpr = node.arguments[0]
      const other = otherExpr ? schemaFromZodExpression(otherExpr, ts, env) : null
      if (!base || !other)
        return base ?? other
      return mergeObjectSchemas(base, other)
    }

    if (method === 'pipe') {
      const targetSchema = node.arguments[0]
      if (targetSchema) {
        const mapped = schemaFromZodExpression(targetSchema, ts, env)
        if (mapped)
          return mapped
      }
      const base = schemaFromZodExpression(target as import('typescript').Expression, ts, env)
      return base ?? null
    }

    if (method === 'transform' || method === 'refine' || method === 'superRefine' || method === 'default' || method === 'catch' || method === 'brand' || method === 'describe') {
      const base = schemaFromZodExpression(target as import('typescript').Expression, ts, env)
      return base ?? null
    }

    if (ts.isIdentifier(callee.expression) && callee.expression.text === 'z') {
      return schemaFromZodCall(method, node.arguments, ts, env)
    }

    if (isZodCoerceCall(callee, ts)) {
      return schemaFromZodCall(method, node.arguments, ts, env)
    }

    const chained = schemaFromZodExpression(target as import('typescript').Expression, ts, env)
    if (!chained)
      return null
    return chained
  }

  if (ts.isIdentifier(callee) && callee.text === 'z')
    return null

  return null
}

function schemaFromZodCall(
  method: string,
  args: readonly import('typescript').Expression[],
  ts: typeof import('typescript'),
  env?: Map<string, SchemaWithFlags>,
): SchemaWithFlags | null {
  switch (method) {
    case 'string':
      return { schema: { type: 'string' } }
    case 'number':
      return { schema: { type: 'number' } }
    case 'boolean':
      return { schema: { type: 'boolean' } }
    case 'date':
      return { schema: { type: 'string', format: 'date-time' } }
    case 'array': {
      const item = args[0] ? schemaFromZodExpression(args[0], ts, env)?.schema : {}
      return { schema: { type: 'array', items: item ?? {} } }
    }
    case 'tuple': {
      const arg = args[0]
      if (arg && ts.isArrayLiteralExpression(arg)) {
        const items = arg.elements.map(el => schemaFromZodExpression(el, ts, env)?.schema ?? {})
        return {
          schema: {
            type: 'array',
            items,
            minItems: items.length,
            maxItems: items.length,
          },
        }
      }
      return { schema: { type: 'array' } }
    }
    case 'object': {
      const shape = args[0]
      if (!shape || !ts.isObjectLiteralExpression(shape))
        return { schema: { type: 'object' } }
      return schemaFromZodObjectShape(shape, ts, env)
    }
    case 'record': {
      const valueType = args.length > 1 ? args[1] : args[0]
      const additionalProperties = valueType ? schemaFromZodExpression(valueType, ts, env)?.schema ?? {} : {}
      const keyType = args.length > 1 ? args[0] : undefined
      const propertyNames = keyType ? schemaFromZodExpression(keyType, ts, env)?.schema : undefined
      const schema: Record<string, unknown> = { type: 'object', additionalProperties }
      if (propertyNames)
        schema.propertyNames = propertyNames
      return { schema }
    }
    case 'enum': {
      const arg = args[0]
      if (arg && ts.isArrayLiteralExpression(arg)) {
        const values = arg.elements
          .map(el => (ts.isStringLiteral(el) ? el.text : undefined))
          .filter((val): val is string => Boolean(val))
        return { schema: { type: 'string', enum: values } }
      }
      return { schema: { type: 'string' } }
    }
    case 'union': {
      const arg = args[0]
      if (arg && ts.isArrayLiteralExpression(arg)) {
        const oneOf = arg.elements.map(el => schemaFromZodExpression(el, ts, env)?.schema ?? {})
        return { schema: { oneOf } }
      }
      return { schema: {} }
    }
    case 'discriminatedUnion': {
      const key = args[0]
      const options = args[1]
      const propertyName = key && ts.isStringLiteral(key) ? key.text : undefined
      if (options && ts.isArrayLiteralExpression(options)) {
        const oneOf = options.elements.map(el => schemaFromZodExpression(el, ts, env)?.schema ?? {})
        const schema: Record<string, unknown> = { oneOf }
        if (propertyName)
          schema.discriminator = { propertyName }
        return { schema }
      }
      return { schema: {} }
    }
    case 'preprocess': {
      const schemaArg = args[1] ?? args[0]
      if (!schemaArg)
        return { schema: {} }
      return schemaFromZodExpression(schemaArg, ts, env) ?? { schema: {} }
    }
    case 'optional': {
      const base = args[0] ? schemaFromZodExpression(args[0], ts, env) : null
      if (!base)
        return null
      return { schema: base.schema, optional: true }
    }
    case 'nullable': {
      const base = args[0] ? schemaFromZodExpression(args[0], ts, env) : null
      if (!base)
        return null
      return { schema: { anyOf: [base.schema, { type: 'null' }] } }
    }
    case 'literal': {
      const arg = args[0]
      if (arg && ts.isStringLiteral(arg))
        return { schema: { type: 'string', const: arg.text } }
      if (arg && ts.isNumericLiteral(arg))
        return { schema: { type: 'number', const: Number(arg.text) } }
      if (arg && (arg.kind === ts.SyntaxKind.TrueKeyword || arg.kind === ts.SyntaxKind.FalseKeyword))
        return { schema: { type: 'boolean', const: arg.kind === ts.SyntaxKind.TrueKeyword } }
      return { schema: {} }
    }
    default:
      return null
  }
}

function schemaFromZodObjectShape(
  shape: import('typescript').ObjectLiteralExpression,
  ts: typeof import('typescript'),
  env?: Map<string, SchemaWithFlags>,
): SchemaWithFlags {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const prop of shape.properties) {
    if (!ts.isPropertyAssignment(prop))
      continue
    const key = propertyNameText(prop.name, ts)
    if (!key)
      continue
    const parsed = schemaFromZodExpression(prop.initializer, ts, env)
    if (!parsed)
      continue
    properties[key] = parsed.schema
    if (!parsed.optional)
      required.push(key)
  }
  const schema: Record<string, unknown> = { type: 'object', properties }
  if (required.length > 0)
    schema.required = required
  return { schema }
}

function mergeObjectSchemas(base: SchemaWithFlags, extension: SchemaWithFlags): SchemaWithFlags {
  const baseObj = base.schema
  const extObj = extension.schema
  if (!isObjectSchema(baseObj) || !isObjectSchema(extObj))
    return base

  const properties = {
    ...(baseObj.properties as Record<string, unknown> | undefined),
    ...(extObj.properties as Record<string, unknown> | undefined),
  }
  const required = [
    ...(Array.isArray(baseObj.required) ? baseObj.required : []),
    ...(Array.isArray(extObj.required) ? extObj.required : []),
  ]
  const schema: Record<string, unknown> = { type: 'object', properties }
  if (required.length > 0)
    schema.required = Array.from(new Set(required))
  return { schema }
}

function isObjectSchema(schema: Record<string, unknown>): schema is { type?: string, properties?: Record<string, unknown>, required?: string[] } {
  return schema.type === 'object'
}

function isZodCoerceCall(
  callee: import('typescript').PropertyAccessExpression,
  ts: typeof import('typescript'),
): boolean {
  if (!ts.isPropertyAccessExpression(callee.expression))
    return false
  const left = callee.expression
  if (!ts.isIdentifier(left.expression))
    return false
  return left.expression.text === 'z' && left.name.text === 'coerce'
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
