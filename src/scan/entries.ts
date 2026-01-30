export type MokupEntry = {
  dir: string
  prefix?: string
  watch?: boolean
  mode?: 'server' | 'sw'
}

export type EntriesParseResult = {
  entries: MokupEntry[]
  warnings: string[]
}

export type EntriesDetectResult = EntriesParseResult & {
  files: string[]
}

export function parseEntriesFromViteConfig(content: string): EntriesParseResult {
  const warnings: string[] = []
  const entries: MokupEntry[] = []

  const astResult = parseEntriesFromViteConfigAst(content)
  if (astResult.entries.length > 0 || astResult.warnings.length > 0)
    warnings.push(...astResult.warnings)
  if (astResult.entries.length > 0)
    return astResult

  const pluginBlocks = findMokupPluginOptionBlocks(content)
  const blocks = pluginBlocks.length > 0 ? pluginBlocks : findEntriesBlocks(content)
  if (blocks.length === 0) {
    warnings.push('No entries option found in Vite config.')
    return { entries, warnings }
  }

  for (const block of blocks) {
    const parsed = parseEntriesBlock(block, warnings)
    entries.push(...parsed)
  }

  if (entries.length === 0)
    warnings.push('Entries detected but no usable dir values were parsed.')

  return { entries, warnings }
}

type StaticPrimitive = string | number | boolean | null
type StaticValue = StaticPrimitive | StaticArray | StaticObject
type StaticArray = StaticValue[]
type StaticObject = { [key: string]: StaticValue }

function parseEntriesFromViteConfigAst(content: string): EntriesParseResult {
  const warnings: string[] = []
  const entries: MokupEntry[] = []

  let ts: typeof import('typescript') | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ts = require('typescript')
  }
  catch {
    warnings.push('TypeScript parser not available; fallback to string parsing.')
    return { entries, warnings }
  }
  if (!ts)
    return { entries, warnings }

  const source = ts.createSourceFile('vite.config.ts', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const env = collectConstBindings(source, ts)

  const visits: Array<import('typescript').CallExpression> = []
  source.forEachChild(function walk(node) {
    if (ts && ts.isCallExpression(node))
      visits.push(node)
    node.forEachChild(walk)
  })

  for (const call of visits) {
    if (!isMokupCall(call, ts))
      continue
    const arg = call.arguments[0]
    if (!arg)
      continue
    const value = evalStaticExpression(arg, env, ts, warnings)
    const parsed = parseEntriesStaticValue(value, warnings)
    if (parsed.length > 0)
      entries.push(...parsed)
  }

  return { entries, warnings }
}

function isMokupCall(node: import('typescript').CallExpression, ts: typeof import('typescript')): boolean {
  const callee = node.expression
  if (ts.isIdentifier(callee))
    return callee.text === 'mokup'
  if (ts.isPropertyAccessExpression(callee))
    return callee.name.text === 'mokup'
  return false
}

function collectConstBindings(source: import('typescript').SourceFile, ts: typeof import('typescript')): Map<string, StaticValue> {
  const env = new Map<string, StaticValue>()
  source.forEachChild((node) => {
    if (!ts.isVariableStatement(node))
      return
    if (!node.declarationList.flags || (node.declarationList.flags & ts.NodeFlags.Const) === 0)
      return
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer)
        continue
      const value = evalStaticExpression(decl.initializer, env, ts, [])
      if (value !== undefined)
        env.set(decl.name.text, value)
    }
  })
  return env
}

function evalStaticExpression(
  node: import('typescript').Expression,
  env: Map<string, StaticValue>,
  ts: typeof import('typescript'),
  warnings: string[],
): StaticValue | undefined {
  if (ts.isStringLiteralLike(node))
    return node.text
  if (ts.isNoSubstitutionTemplateLiteral(node))
    return node.text
  if (ts.isNumericLiteral(node))
    return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword)
    return true
  if (node.kind === ts.SyntaxKind.FalseKeyword)
    return false
  if (node.kind === ts.SyntaxKind.NullKeyword)
    return null
  if (ts.isIdentifier(node))
    return env.get(node.text)

  if (ts.isTemplateExpression(node)) {
    const head = node.head.text
    const parts: string[] = [head]
    for (const span of node.templateSpans) {
      const expr = evalStaticExpression(span.expression, env, ts, warnings)
      if (typeof expr !== 'string' && typeof expr !== 'number') {
        warnings.push('Template expression contains non-static value.')
        return undefined
      }
      parts.push(String(expr), span.literal.text)
    }
    return parts.join('')
  }

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = evalStaticExpression(node.left, env, ts, warnings)
    const right = evalStaticExpression(node.right, env, ts, warnings)
    if (left === undefined || right === undefined) {
      warnings.push('Binary expression contains non-static value.')
      return undefined
    }
    return `${left}${right}`
  }

  if (ts.isArrayLiteralExpression(node)) {
    const items: StaticValue[] = []
    for (const element of node.elements) {
      if (ts.isSpreadElement(element)) {
        warnings.push('Spread elements in entries are not supported.')
        continue
      }
      const value = evalStaticExpression(element as import('typescript').Expression, env, ts, warnings)
      if (value === undefined) {
        warnings.push('Array element is not a static value.')
        continue
      }
      items.push(value)
    }
    return items
  }

  if (ts.isObjectLiteralExpression(node)) {
    const obj: Record<string, StaticValue> = {}
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const key = getPropertyKey(prop.name, ts)
        if (!key)
          continue
        const value = evalStaticExpression(prop.initializer, env, ts, warnings)
        if (value !== undefined)
          obj[key] = value
      }
      else if (ts.isShorthandPropertyAssignment(prop)) {
        const key = prop.name.text
        const value = env.get(key)
        if (value !== undefined)
          obj[key] = value
      }
      else {
        warnings.push('Unsupported object literal property in entries.')
      }
    }
    return obj
  }

  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
    return evalStaticExpression(node.expression, env, ts, warnings)

  if (ts.isCallExpression(node)) {
    if (ts.isIdentifier(node.expression) && node.expression.text === 'defineConfig' && node.arguments[0])
      return evalStaticExpression(node.arguments[0], env, ts, warnings)

    const callValue = evalPathCall(node, env, ts, warnings)
    if (callValue !== undefined)
      return callValue
  }

  warnings.push('Unsupported expression in entries parsing.')
  return undefined
}

function evalPathCall(
  node: import('typescript').CallExpression,
  env: Map<string, StaticValue>,
  ts: typeof import('typescript'),
  warnings: string[],
): StaticValue | undefined {
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee))
    return undefined
  const method = callee.name.text
  if (method !== 'resolve' && method !== 'join')
    return undefined
  if (!ts.isIdentifier(callee.expression) || callee.expression.text !== 'path')
    return undefined

  const args: string[] = []
  for (const arg of node.arguments) {
    const value = evalStaticExpression(arg, env, ts, warnings)
    if (value === undefined) {
      warnings.push('path.resolve/join contains non-static value.')
      return undefined
    }
    args.push(String(value))
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('node:path') as typeof import('node:path')
    return method === 'resolve' ? path.resolve(...args) : path.join(...args)
  }
  catch {
    warnings.push('Failed to evaluate path.resolve/join.')
    return undefined
  }
}

function getPropertyKey(name: import('typescript').PropertyName, ts: typeof import('typescript')): string | null {
  if (ts.isIdentifier(name))
    return name.text
  if (ts.isStringLiteral(name))
    return name.text
  if (ts.isNumericLiteral(name))
    return name.text
  return null
}

function parseEntriesStaticValue(value: StaticValue | undefined, warnings: string[]): MokupEntry[] {
  if (value === undefined || value === null)
    return []
  if (typeof value === 'string')
    return [{ dir: value }]

  if (Array.isArray(value)) {
    const results: MokupEntry[] = []
    for (const item of value) {
      const parsed = parseEntriesStaticValue(item, warnings)
      results.push(...parsed)
    }
    return results
  }

  if (typeof value === 'object') {
    const entry = value as Record<string, StaticValue>
    if ('entries' in entry) {
      const nested = parseEntriesStaticValue(entry.entries, warnings)
      if (nested.length > 0)
        return nested
    }

    const dirValue = entry.dir
    const dirs = extractDirsFromStaticValue(dirValue)
    if (dirs.length === 0) {
      warnings.push('Entry object has no static dir value.')
      return []
    }
    const prefix = typeof entry.prefix === 'string' ? entry.prefix : undefined
    const watch = typeof entry.watch === 'boolean' ? entry.watch : undefined
    const mode = entry.mode === 'server' || entry.mode === 'sw' ? entry.mode : undefined

    return dirs.map(dir => ({ dir, prefix, watch, mode }))
  }

  warnings.push('Entries value is not a supported static type.')
  return []
}

function extractDirsFromStaticValue(value: StaticValue | undefined): string[] {
  if (!value)
    return []
  if (typeof value === 'string')
    return [value]
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string')
  return []
}

function findMokupPluginOptionBlocks(content: string): string[] {
  const blocks: string[] = []
  const re = /\bmokup\s*\(/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content))) {
    const callStart = match.index + match[0].length - 1
    const callEnd = findMatching(content, callStart, ')')
    if (callEnd === -1)
      continue
    const args = content.slice(callStart + 1, callEnd)
    const firstArg = extractFirstArg(args)
    if (!firstArg)
      continue
    if (firstArg.trim().startsWith('{'))
      blocks.push(firstArg)
  }
  return blocks
}

function extractFirstArg(args: string): string | null {
  let depth = 0
  let inString: string | null = null
  let escape = false
  let start = 0

  for (let i = 0; i < args.length; i++) {
    const ch = args[i]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === inString)
        inString = null
      continue
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      inString = ch
      continue
    }

    if (ch === '(' || ch === '[' || ch === '{')
      depth++
    else if (ch === ')' || ch === ']' || ch === '}')
      depth--

    if (ch === ',' && depth === 0)
      return args.slice(start, i).trim() || null
  }

  const rest = args.slice(start).trim()
  return rest || null
}

export async function detectEntriesFromConfigFiles(
  files: string[],
  readFile: (path: string) => Promise<string | null>,
): Promise<EntriesDetectResult> {
  const entries: MokupEntry[] = []
  const warnings: string[] = []
  for (const file of files) {
    const content = await readFile(file)
    if (!content) {
      warnings.push(`Failed to read config file: ${file}`)
      continue
    }
    const result = parseEntriesFromViteConfig(content)
    result.entries.forEach(entry => entries.push(entry))
    result.warnings.forEach(w => warnings.push(`${file}: ${w}`))
  }

  return {
    files,
    entries,
    warnings,
  }
}

function parseEntriesBlock(block: string, warnings: string[]): MokupEntry[] {
  const trimmed = block.trim()
  if (!trimmed)
    return []

  if (trimmed.startsWith('['))
    return parseEntriesArray(trimmed, warnings)

  if (trimmed.startsWith('{'))
    return parseEntryObject(trimmed, warnings)

  if (trimmed.startsWith('\'') || trimmed.startsWith('"') || trimmed.startsWith('`')) {
    const dir = parseStringLiteral(trimmed)
    return dir ? [{ dir }] : []
  }

  warnings.push('Entries value is not a literal array/object/string, skipped.')
  return []
}

function parseEntriesArray(arrayLiteral: string, warnings: string[]): MokupEntry[] {
  const inner = arrayLiteral.trim().slice(1, -1)
  const items = splitTopLevelItems(inner)
  const results: MokupEntry[] = []

  for (const item of items) {
    const trimmed = item.trim()
    if (!trimmed)
      continue

    if (trimmed.startsWith('{')) {
      results.push(...parseEntryObject(trimmed, warnings))
      continue
    }

    if (trimmed.startsWith('[')) {
      warnings.push('Nested array entries are not supported, skipping.')
      continue
    }

    const dir = parseStringLiteral(trimmed)
    if (dir)
      results.push({ dir })
    else
      warnings.push('Array entry is not a string/object literal, skipping.')
  }

  return results
}

function parseEntryObject(objectLiteral: string, warnings: string[]): MokupEntry[] {
  const dirValue = extractValueSlice(objectLiteral, 'dir')
  const prefixValue = extractValueSlice(objectLiteral, 'prefix')
  const watchValue = extractValueSlice(objectLiteral, 'watch')
  const modeValue = extractValueSlice(objectLiteral, 'mode')

  const dirs = extractStringLiterals(dirValue)
  const prefix = extractStringLiterals(prefixValue)[0]
  const watch = parseBooleanLiteral(watchValue)
  const mode = parseModeLiteral(modeValue)

  if (dirs.length === 0) {
    warnings.push('Entry object has no string dir literal, skipping.')
    return []
  }

  return dirs.map(dir => ({
    dir,
    prefix,
    watch,
    mode,
  }))
}

function findEntriesBlocks(content: string): string[] {
  const blocks: string[] = []
  const re = /\bentries\s*[:=]\s*/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content))) {
    let index = match.index + match[0].length
    index = skipWhitespace(content, index)
    const start = index
    const ch = content[start]
    if (ch === '[' || ch === '{') {
      const end = findMatching(content, start, ch === '[' ? ']' : '}')
      if (end !== -1)
        blocks.push(content.slice(start, end + 1))
      continue
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      const end = findStringEnd(content, start)
      if (end !== -1)
        blocks.push(content.slice(start, end + 1))
      continue
    }
  }
  return blocks
}

function splitTopLevelItems(arrayLiteral: string): string[] {
  const items: string[] = []
  let depth = 0
  let current = ''
  let inString: string | null = null
  let escape = false

  for (let i = 0; i < arrayLiteral.length; i++) {
    const ch = arrayLiteral[i]
    if (inString) {
      current += ch
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === inString)
        inString = null
      continue
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      inString = ch
      current += ch
      continue
    }

    if (ch === '[' || ch === '{' || ch === '(') {
      depth++
      current += ch
      continue
    }

    if (ch === ']' || ch === '}' || ch === ')') {
      depth--
      current += ch
      continue
    }

    if (ch === ',' && depth === 0) {
      items.push(current.trim())
      current = ''
      continue
    }

    current += ch
  }

  if (current.trim())
    items.push(current.trim())

  return items
}

function extractValueSlice(objectLiteral: string, key: string): string | null {
  const re = new RegExp(`\\b${key}\\s*:\\s*`)
  const match = re.exec(objectLiteral)
  if (!match)
    return null
  let index = match.index + match[0].length
  index = skipWhitespace(objectLiteral, index)
  const start = index

  let depthParen = 0
  let depthBracket = 0
  let depthBrace = 0
  let inString: string | null = null
  let escape = false

  for (let i = start; i < objectLiteral.length; i++) {
    const ch = objectLiteral[i]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === inString)
        inString = null
      continue
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      inString = ch
      continue
    }

    if (ch === '(')
      depthParen++
    else if (ch === ')')
      depthParen--
    else if (ch === '[')
      depthBracket++
    else if (ch === ']')
      depthBracket--
    else if (ch === '{')
      depthBrace++
    else if (ch === '}') {
      if (depthBrace === 0)
        return objectLiteral.slice(start, i).trim()
      depthBrace--
    }

    if (ch === ',' && depthParen === 0 && depthBracket === 0 && depthBrace === 0)
      return objectLiteral.slice(start, i).trim()
  }

  return objectLiteral.slice(start).trim()
}

function extractStringLiterals(value: string | null): string[] {
  if (!value)
    return []
  const results: string[] = []
  const re = /(['"`])([^'"`]+)\1/g
  let match: RegExpExecArray | null
  while ((match = re.exec(value)))
    results.push(match[2])
  return results
}

function parseBooleanLiteral(value: string | null): boolean | undefined {
  if (!value)
    return undefined
  if (/\btrue\b/.test(value))
    return true
  if (/\bfalse\b/.test(value))
    return false
  return undefined
}

function parseModeLiteral(value: string | null): 'server' | 'sw' | undefined {
  if (!value)
    return undefined
  if (/\bserver\b/.test(value))
    return 'server'
  if (/\bsw\b/.test(value))
    return 'sw'
  return undefined
}

function parseStringLiteral(value: string): string | null {
  const trimmed = value.trim()
  const match = trimmed.match(/^(['"`])([^'"`]+)\1/)
  return match ? match[2] : null
}

function skipWhitespace(content: string, index: number): number {
  let i = index
  while (i < content.length && /\s/.test(content[i]))
    i++
  return i
}

function findMatching(content: string, start: number, closeChar: string): number {
  const openChar = content[start]
  let depth = 0
  let inString: string | null = null
  let escape = false

  for (let i = start; i < content.length; i++) {
    const ch = content[i]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === inString)
        inString = null
      continue
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      inString = ch
      continue
    }

    if (ch === openChar)
      depth++
    else if (ch === closeChar) {
      depth--
      if (depth === 0)
        return i
    }
  }
  return -1
}

function findStringEnd(content: string, start: number): number {
  const quote = content[start]
  let escape = false
  for (let i = start + 1; i < content.length; i++) {
    const ch = content[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === quote)
      return i
  }
  return -1
}
