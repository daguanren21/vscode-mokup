import type { MockRoute } from '../mock/routes'

export type PreviewResult = {
  text: string
  meta: string
}

type EnvValue = {
  type: 'expr'
  value: import('typescript').Expression
} | {
  type: 'value'
  value: unknown
}

type Env = Map<string, EnvValue>

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
): Env {
  const env: Env = new Map()
  source.forEachChild((node) => {
    if (!ts.isVariableStatement(node))
      return
    if ((node.declarationList.flags & ts.NodeFlags.Const) === 0)
      return
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer)
        env.set(decl.name.text, { type: 'expr', value: decl.initializer })
    }
  })
  return env
}

function extractObjectFromExpression(
  expr: import('typescript').Expression,
  ts: typeof import('typescript'),
  env: Env,
): unknown | undefined {
  if (ts.isParenthesizedExpression(expr))
    return extractObjectFromExpression(expr.expression, ts, env)
  if (ts.isIdentifier(expr)) {
    const resolved = env.get(expr.text)
    if (resolved?.type === 'expr')
      return extractObjectFromExpression(resolved.value, ts, env)
    if (resolved?.type === 'value')
      return resolved.value
  }
  if (ts.isObjectLiteralExpression(expr))
    return evalObjectLiteral(expr, ts, env)
  if (ts.isCallExpression(expr)) {
    const returned = extractDefineHandlerReturn(expr, ts, env)
    if (returned !== undefined)
      return returned
    const fn = expr.arguments[0]
    if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
      const returnedFn = findReturnedObject(fn, ts, env)
      if (returnedFn !== undefined)
        return returnedFn
    }
  }
  return undefined
}

function evalObjectLiteral(
  node: import('typescript').ObjectLiteralExpression,
  ts: typeof import('typescript'),
  env: Env,
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
      const resolved = env.get(key)
      if (resolved?.type === 'value')
        result[key] = resolved.value
      else if (resolved?.type === 'expr')
        result[key] = evalValue(resolved.value, ts, env)
      else
        result[key] = `<${key}>`
    }
  }
  return result
}

function evalValue(
  node: import('typescript').Expression,
  ts: typeof import('typescript'),
  env: Env,
): unknown {
  if (ts.isParenthesizedExpression(node))
    return evalValue(node.expression, ts, env)
  if (ts.isStringLiteralLike(node))
    return node.text
  if (ts.isNumericLiteral(node))
    return Number(node.text)
  if (ts.isNoSubstitutionTemplateLiteral(node))
    return node.text
  if (ts.isTemplateExpression(node))
    return evalTemplateExpression(node, env)
  if (ts.isPrefixUnaryExpression(node))
    return evalPrefixUnary(node, ts, env)
  if (ts.isBinaryExpression(node))
    return evalBinaryExpression(node, ts, env)
  if (ts.isConditionalExpression(node))
    return evalConditionalExpression(node, ts, env)
  if (node.kind === ts.SyntaxKind.TrueKeyword)
    return true
  if (node.kind === ts.SyntaxKind.FalseKeyword)
    return false
  if (node.kind === ts.SyntaxKind.NullKeyword)
    return null
  if (ts.isArrayLiteralExpression(node))
    return node.elements.map(el => evalValue(el as import('typescript').Expression, ts, env))
  if (ts.isAsExpression(node))
    return evalValue(node.expression, ts, env)
  if (ts.isNonNullExpression(node))
    return evalValue(node.expression, ts, env)
  if (ts.isObjectLiteralExpression(node))
    return evalObjectLiteral(node, ts, env)
  if (ts.isIdentifier(node)) {
    const resolved = env.get(node.text)
    if (resolved?.type === 'value')
      return resolved.value
    if (resolved?.type === 'expr')
      return evalValue(resolved.value, ts, env)
    return `<${node.text}>`
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const returned = findReturnedObject(node, ts, env)
    if (returned !== undefined)
      return returned
    return '<function>'
  }
  if (ts.isCallExpression(node)) {
    return evalCallExpression(node, ts, env)
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
  env: Env,
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
  env: Env,
): unknown | undefined {
  const arg = expr.arguments[0]
  if (!arg)
    return undefined
  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
    const returned = findReturnedObject(arg, ts, env)
    if (returned !== undefined)
      return returned
    return '<function>'
  }
  if (ts.isObjectLiteralExpression(arg)) {
    const handlerExpr = resolveObjectProperty(arg, 'handler', ts, env)
    if (handlerExpr) {
      const handlerFn = resolveFunctionExpression(handlerExpr, ts, env)
      if (handlerFn) {
        const returned = findReturnedObject(handlerFn, ts, env)
        if (returned !== undefined)
          return returned
        return '<function>'
      }
    }
  }
  return undefined
}

function findReturnedObject(
  fn: import('typescript').ArrowFunction | import('typescript').FunctionExpression,
  ts: typeof import('typescript'),
  env: Env,
  paramValues?: unknown[],
): unknown | undefined {
  const localEnv = createFunctionEnv(fn, ts, env, paramValues)
  if (!ts.isBlock(fn.body))
    return evalValue(fn.body as import('typescript').Expression, ts, localEnv)
  const returns = collectReturnExpressions(fn.body, ts)
  let lastObject: import('typescript').Expression | undefined
  let lastIdentifier: import('typescript').Expression | undefined
  let lastExpr: import('typescript').Expression | undefined
  for (const expr of returns) {
    lastExpr = expr
    if (ts.isObjectLiteralExpression(expr))
      lastObject = expr
    else if (ts.isIdentifier(expr))
      lastIdentifier = expr
  }
  if (lastObject)
    return evalObjectLiteral(lastObject as import('typescript').ObjectLiteralExpression, ts, localEnv)
  if (lastIdentifier && ts.isIdentifier(lastIdentifier)) {
    const resolved = localEnv.get(lastIdentifier.text)
    if (resolved?.type === 'value')
      return resolved.value
    if (resolved?.type === 'expr')
      return evalValue(resolved.value, ts, localEnv)
  }
  if (lastExpr)
    return evalValue(lastExpr, ts, localEnv)
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

function createFunctionEnv(
  fn: import('typescript').ArrowFunction | import('typescript').FunctionExpression,
  ts: typeof import('typescript'),
  baseEnv: Env,
  paramValues?: unknown[],
): Env {
  const env: Env = new Map(baseEnv)
  for (let i = 0; i < fn.parameters.length; i++) {
    const param = fn.parameters[i]
    if (!ts.isIdentifier(param.name))
      continue
    if (!paramValues || i >= paramValues.length)
      continue
    env.set(param.name.text, { type: 'value', value: paramValues[i] })
  }
  if (ts.isBlock(fn.body))
    collectConstExpressionsInNode(fn.body, ts, env)
  return env
}

function collectConstExpressionsInNode(
  node: import('typescript').Node,
  ts: typeof import('typescript'),
  env: Env,
): void {
  const walk = (current: import('typescript').Node) => {
    if (current !== node && (ts.isArrowFunction(current) || ts.isFunctionExpression(current) || ts.isFunctionDeclaration(current)))
      return
    if (ts.isVariableStatement(current)) {
      if ((current.declarationList.flags & ts.NodeFlags.Const) !== 0) {
        for (const decl of current.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer)
            env.set(decl.name.text, { type: 'expr', value: decl.initializer })
        }
      }
    }
    current.forEachChild(walk)
  }
  walk(node)
}

function evalTemplateExpression(
  node: import('typescript').TemplateExpression,
  env: Env,
): string {
  let result = node.head.text
  for (const span of node.templateSpans) {
    const value = evalValue(span.expression, ts, env)
    if (value === '<expr>')
      result += '<expr>'
    else if (value == null)
      result += String(value)
    else if (typeof value === 'object')
      result += JSON.stringify(value)
    else
      result += String(value)
    result += span.literal.text
  }
  return result
}

function evalPrefixUnary(
  node: import('typescript').PrefixUnaryExpression,
  ts: typeof import('typescript'),
  env: Env,
): unknown {
  const value = evalValue(node.operand, ts, env)
  if (value === '<expr>')
    return '<expr>'
  switch (node.operator) {
    case ts.SyntaxKind.ExclamationToken:
      return !value
    case ts.SyntaxKind.PlusToken:
      return typeof value === 'number' ? value : Number(value)
    case ts.SyntaxKind.MinusToken:
      return typeof value === 'number' ? -value : Number.isNaN(Number(value)) ? '<expr>' : -Number(value)
    default:
      return '<expr>'
  }
}

function evalBinaryExpression(
  node: import('typescript').BinaryExpression,
  ts: typeof import('typescript'),
  env: Env,
): unknown {
  const left = evalValue(node.left, ts, env)
  const right = evalValue(node.right, ts, env)
  if (left === '<expr>' || right === '<expr>')
    return '<expr>'
  switch (node.operatorToken.kind) {
    case ts.SyntaxKind.PlusToken:
      if (typeof left === 'string' || typeof right === 'string')
        return String(left) + String(right)
      if (typeof left === 'number' && typeof right === 'number')
        return left + right
      return '<expr>'
    case ts.SyntaxKind.MinusToken:
      if (typeof left === 'number' && typeof right === 'number')
        return left - right
      return '<expr>'
    case ts.SyntaxKind.AsteriskToken:
      if (typeof left === 'number' && typeof right === 'number')
        return left * right
      return '<expr>'
    case ts.SyntaxKind.SlashToken:
      if (typeof left === 'number' && typeof right === 'number')
        return right === 0 ? '<expr>' : left / right
      return '<expr>'
    case ts.SyntaxKind.PercentToken:
      if (typeof left === 'number' && typeof right === 'number')
        return left % right
      return '<expr>'
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return left === right
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return left !== right
    case ts.SyntaxKind.EqualsEqualsToken:
      return left == right
    case ts.SyntaxKind.ExclamationEqualsToken:
      return left != right
    case ts.SyntaxKind.GreaterThanToken:
      if (typeof left === 'number' && typeof right === 'number')
        return left > right
      return '<expr>'
    case ts.SyntaxKind.GreaterThanEqualsToken:
      if (typeof left === 'number' && typeof right === 'number')
        return left >= right
      return '<expr>'
    case ts.SyntaxKind.LessThanToken:
      if (typeof left === 'number' && typeof right === 'number')
        return left < right
      return '<expr>'
    case ts.SyntaxKind.LessThanEqualsToken:
      if (typeof left === 'number' && typeof right === 'number')
        return left <= right
      return '<expr>'
    case ts.SyntaxKind.AmpersandAmpersandToken:
      return left && right
    case ts.SyntaxKind.BarBarToken:
      return left || right
    default:
      return '<expr>'
  }
}

function evalConditionalExpression(
  node: import('typescript').ConditionalExpression,
  ts: typeof import('typescript'),
  env: Env,
): unknown {
  const condition = evalValue(node.condition, ts, env)
  if (condition === '<expr>')
    return '<expr>'
  return condition ? evalValue(node.whenTrue, ts, env) : evalValue(node.whenFalse, ts, env)
}

function evalCallExpression(
  node: import('typescript').CallExpression,
  ts: typeof import('typescript'),
  env: Env,
): unknown {
  const defineHandler = extractDefineHandlerReturn(node, ts, env)
  if (defineHandler !== undefined)
    return defineHandler
  const arrayFrom = evalArrayFromCall(node, ts, env)
  if (arrayFrom !== undefined)
    return arrayFrom
  const fakerValue = evalFakerCall(node, ts, env)
  if (fakerValue !== undefined)
    return fakerValue
  return '<expr>'
}

function evalArrayFromCall(
  node: import('typescript').CallExpression,
  ts: typeof import('typescript'),
  env: Env,
): unknown[] | undefined {
  if (!isArrayFromCall(node, ts))
    return undefined
  const length = extractArrayFromLength(node.arguments[0], ts, env)
  if (typeof length !== 'number' || !Number.isFinite(length))
    return []
  const result: unknown[] = []
  const mapper = node.arguments[1]
  for (let index = 0; index < length; index++) {
    if (mapper && (ts.isArrowFunction(mapper) || ts.isFunctionExpression(mapper))) {
      const returned = findReturnedObject(mapper, ts, env, [undefined, index])
      result.push(returned === undefined ? null : returned)
    }
    else {
      result.push(null)
    }
  }
  return result
}

function isArrayFromCall(node: import('typescript').CallExpression, ts: typeof import('typescript')): boolean {
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee))
    return false
  if (callee.name.text !== 'from')
    return false
  return ts.isIdentifier(callee.expression) && callee.expression.text === 'Array'
}

function extractArrayFromLength(
  node: import('typescript').Expression | undefined,
  ts: typeof import('typescript'),
  env: Env,
): number | undefined {
  if (!node)
    return undefined
  if (ts.isArrayLiteralExpression(node))
    return node.elements.length
  if (ts.isObjectLiteralExpression(node)) {
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop))
        continue
      const key = getPropName(prop.name, ts)
      if (key !== 'length')
        continue
      const value = evalValue(prop.initializer, ts, env)
      if (typeof value === 'number' && Number.isFinite(value))
        return value
    }
  }
  const value = evalValue(node, ts, env)
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function evalFakerCall(
  node: import('typescript').CallExpression,
  ts: typeof import('typescript'),
  env: Env,
): unknown | undefined {
  const path = getPropertyAccessPath(node.expression, ts)
  if (!path || path[0] !== 'faker')
    return undefined
  const method = path.slice(1).join('.')
  if (method === 'string.numeric') {
    const lengthValue = node.arguments[0] ? evalValue(node.arguments[0], ts, env) : 0
    const length = typeof lengthValue === 'number' && Number.isFinite(lengthValue) ? Math.max(1, Math.floor(lengthValue)) : 6
    return makeNumericString(length)
  }
  if (method === 'commerce.productName') {
    return 'Sample Product'
  }
  return `<${path.join('.')}>`
}

function getPropertyAccessPath(
  node: import('typescript').Expression,
  ts: typeof import('typescript'),
): string[] | null {
  const parts: string[] = []
  let current: import('typescript').Expression | undefined = node
  while (current && ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text)
    current = current.expression
  }
  if (current && ts.isIdentifier(current)) {
    parts.unshift(current.text)
    return parts
  }
  return null
}

function makeNumericString(length: number): string {
  const digits = '0123456789'
  let result = ''
  for (let i = 0; i < length; i++)
    result += digits[i % digits.length]
  return result
}

function resolveObjectProperty(
  node: import('typescript').ObjectLiteralExpression,
  key: string,
  ts: typeof import('typescript'),
  env: Env,
): import('typescript').Expression | undefined {
  for (const prop of node.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const name = getPropName(prop.name, ts)
      if (name === key)
        return prop.initializer
    }
    else if (ts.isShorthandPropertyAssignment(prop)) {
      if (prop.name.text !== key)
        continue
      const resolved = env.get(prop.name.text)
      if (resolved?.type === 'expr')
        return resolved.value
    }
  }
  return undefined
}

function resolveFunctionExpression(
  node: import('typescript').Expression,
  ts: typeof import('typescript'),
  env: Env,
): import('typescript').ArrowFunction | import('typescript').FunctionExpression | undefined {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
    return node
  if (ts.isIdentifier(node)) {
    const resolved = env.get(node.text)
    if (resolved?.type === 'expr')
      return resolveFunctionExpression(resolved.value, ts, env)
  }
  return undefined
}
