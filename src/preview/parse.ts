import type { MockRoute } from '../mock/routes'

export type PreviewResult = {
  text: string
  meta: string
}

export function buildPreview(route: MockRoute, raw: string): PreviewResult {
  const ext = route.sourceFile.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'json' || ext === 'jsonc') {
    const parsed = parseJsonLike(raw)
    if (parsed.ok)
      return { text: JSON.stringify(parsed.value, null, 2), meta: 'parsed json' }
    return { text: raw, meta: 'raw json (parse failed)' }
  }

  if (ext === 'ts' || ext === 'js' || ext === 'mjs' || ext === 'cjs') {
    const parsed = parseTsExportedObject(raw)
    if (parsed.ok)
      return { text: JSON.stringify(parsed.value, null, 2), meta: parsed.meta }
    return { text: raw, meta: 'raw source' }
  }

  return { text: raw, meta: 'raw source' }
}

function parseJsonLike(raw: string): { ok: true, value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) }
  }
  catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const jsonc = require('jsonc-parser') as typeof import('jsonc-parser')
      return { ok: true, value: jsonc.parse(raw) }
    }
    catch {
      return { ok: false }
    }
  }
}

function parseTsExportedObject(raw: string): { ok: true, value: unknown, meta: string } | { ok: false } {
  let ts: typeof import('typescript') | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ts = require('typescript')
  }
  catch {
    return { ok: false }
  }
  if (!ts)
    return { ok: false }

  const source = ts.createSourceFile('mock.ts', raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const env = collectConstExpressions(source, ts)

  for (const stmt of source.statements) {
    if (ts.isExportAssignment(stmt)) {
      const value = extractObjectFromExpression(stmt.expression, ts, env)
      if (value !== undefined)
        return { ok: true, value, meta: 'parsed export default' }
    }
  }

  return { ok: false }
}

function collectConstExpressions(
  source: import('typescript').SourceFile,
  ts: typeof import('typescript'),
): Map<string, import('typescript').Expression> {
  const env = new Map<string, import('typescript').Expression>()
  source.forEachChild((node) => {
    if (!ts.isVariableStatement(node))
      return
    if ((node.declarationList.flags & ts.NodeFlags.Const) === 0)
      return
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer)
        env.set(decl.name.text, decl.initializer)
    }
  })
  return env
}

function extractObjectFromExpression(
  expr: import('typescript').Expression,
  ts: typeof import('typescript'),
  env: Map<string, import('typescript').Expression>,
): unknown | undefined {
  if (ts.isParenthesizedExpression(expr))
    return extractObjectFromExpression(expr.expression, ts, env)
  if (ts.isIdentifier(expr)) {
    const resolved = env.get(expr.text)
    if (resolved)
      return extractObjectFromExpression(resolved, ts, env)
  }
  if (ts.isObjectLiteralExpression(expr))
    return evalObjectLiteral(expr, ts, env)
  if (ts.isCallExpression(expr)) {
    const fn = expr.arguments[0]
    if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
      const returned = findReturnedObject(fn, ts, env)
      if (returned !== undefined)
        return returned
    }
  }
  return undefined
}

function evalObjectLiteral(
  node: import('typescript').ObjectLiteralExpression,
  ts: typeof import('typescript'),
  env: Map<string, import('typescript').Expression>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const prop of node.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const key = getPropName(prop.name, ts)
      if (!key)
        continue
      result[key] = evalValue(prop.initializer, ts, env)
    }
    else if (ts.isShorthandPropertyAssignment(prop)) {
      const key = prop.name.text
      result[key] = `<${key}>`
    }
  }
  return result
}

function evalValue(
  node: import('typescript').Expression,
  ts: typeof import('typescript'),
  env: Map<string, import('typescript').Expression>,
): unknown {
  if (ts.isStringLiteralLike(node))
    return node.text
  if (ts.isNumericLiteral(node))
    return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword)
    return true
  if (node.kind === ts.SyntaxKind.FalseKeyword)
    return false
  if (node.kind === ts.SyntaxKind.NullKeyword)
    return null
  if (ts.isArrayLiteralExpression(node))
    return node.elements.map(el => evalValue(el as import('typescript').Expression, ts, env))
  if (ts.isObjectLiteralExpression(node))
    return evalObjectLiteral(node, ts, env)
  if (ts.isIdentifier(node)) {
    const resolved = env.get(node.text)
    if (resolved)
      return evalValue(resolved, ts, env)
    return `<${node.text}>`
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const returned = findReturnedObject(node, ts, env)
    if (returned !== undefined)
      return returned
    return '<function>'
  }
  if (ts.isCallExpression(node)) {
    const returned = extractDefineHandlerReturn(node, ts, env)
    if (returned !== undefined)
      return returned
    return '<expr>'
  }
  return '<expr>'
}

function getPropName(name: import('typescript').PropertyName, ts: typeof import('typescript')): string | null {
  if (ts.isIdentifier(name))
    return name.text
  if (ts.isStringLiteral(name))
    return name.text
  if (ts.isNumericLiteral(name))
    return name.text
  return null
}

function extractDefineHandlerReturn(
  expr: import('typescript').CallExpression,
  ts: typeof import('typescript'),
  env: Map<string, import('typescript').Expression>,
): unknown | undefined {
  const callee = expr.expression
  if (ts.isIdentifier(callee) && callee.text === 'defineHandler')
    return extractHandlerReturnArg(expr, ts, env)
  if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'defineHandler')
    return extractHandlerReturnArg(expr, ts, env)
  return undefined
}

function extractHandlerReturnArg(
  expr: import('typescript').CallExpression,
  ts: typeof import('typescript'),
  env: Map<string, import('typescript').Expression>,
): unknown | undefined {
  const fn = expr.arguments[0]
  if (!fn || (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)))
    return undefined
  const returned = findReturnedObject(fn, ts, env)
  if (returned !== undefined)
    return returned
  return '<function>'
}

function findReturnedObject(
  fn: import('typescript').ArrowFunction | import('typescript').FunctionExpression,
  ts: typeof import('typescript'),
  env: Map<string, import('typescript').Expression>,
): unknown | undefined {
  if (ts.isObjectLiteralExpression(fn.body))
    return evalObjectLiteral(fn.body, ts, env)
  if (!ts.isBlock(fn.body))
    return undefined
  const returns = collectReturnExpressions(fn.body, ts)
  let lastObject: import('typescript').Expression | undefined
  for (const expr of returns) {
    if (ts.isObjectLiteralExpression(expr))
      lastObject = expr
  }
  if (lastObject)
    return evalObjectLiteral(lastObject as import('typescript').ObjectLiteralExpression, ts, env)
  for (const expr of returns) {
    if (ts.isIdentifier(expr)) {
      const resolved = env.get(expr.text)
      if (resolved)
        return evalValue(resolved, ts, env)
    }
  }
  return undefined
}

function collectReturnExpressions(
  node: import('typescript').Node,
  ts: typeof import('typescript'),
): import('typescript').Expression[] {
  const results: import('typescript').Expression[] = []
  const walk = (current: import('typescript').Node) => {
    if (ts.isReturnStatement(current) && current.expression) {
      results.push(current.expression)
      return
    }
    if (
      ts.isFunctionExpression(current)
      || ts.isArrowFunction(current)
      || ts.isFunctionDeclaration(current)
      || ts.isMethodDeclaration(current)
    ) {
      return
    }
    current.forEachChild(walk)
  }
  walk(node)
  return results
}
