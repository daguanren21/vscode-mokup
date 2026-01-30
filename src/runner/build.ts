import { spawn } from 'node:child_process'
import type { OutputChannel } from 'vscode'
import type { DetectedEntry } from '../scan/collect'

export type CliBuildResult = {
  command: string
  args: string[]
  cwd: string
  exitCode: number | null
  durationMs: number
  stdout: string
  stderr: string
  combined: string
}

export type ParsedCliOutput = {
  files: string[]
  routes: string[]
  warnings: string[]
  errors: string[]
  notes: string[]
  stats: {
    files?: number
    routes?: number
  }
  raw: string
}

export async function runCliBuild(
  entry: DetectedEntry,
  command: string,
  args: string[],
  output: OutputChannel,
): Promise<CliBuildResult> {
  const resolvedArgs = args.map(arg => replacePlaceholders(arg, entry))
  const start = Date.now()
  output.appendLine(`[mokup] build: ${command} ${resolvedArgs.join(' ')}`)

  return await new Promise((resolve) => {
    const proc = spawn(command, resolvedArgs, {
      cwd: entry.packageRoot,
      shell: true,
      env: process.env,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => {
      const text = data.toString()
      stdout += text
      output.append(text)
    })
    proc.stderr?.on('data', (data) => {
      const text = data.toString()
      stderr += text
      output.append(text)
    })
    proc.on('error', (err) => {
      const text = `[mokup] build failed to start: ${String(err)}\n`
      stderr += text
      output.append(text)
    })
    proc.on('close', (code) => {
      const durationMs = Date.now() - start
      output.appendLine(`[mokup] build exit code=${code ?? 'null'} duration=${durationMs}ms`)
      resolve({
        command,
        args: resolvedArgs,
        cwd: entry.packageRoot,
        exitCode: code ?? null,
        durationMs,
        stdout,
        stderr,
        combined: [stdout, stderr].filter(Boolean).join('\n'),
      })
    })
  })
}

export function parseCliOutput(text: string): ParsedCliOutput {
  const files = new Set<string>()
  const routes = new Set<string>()
  const warnings: string[] = []
  const errors: string[] = []
  const notes: string[] = []
  const stats: ParsedCliOutput['stats'] = {}

  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed)
      continue

    const jsonPayload = tryParseJsonLine(trimmed)
    if (jsonPayload) {
      if (Array.isArray(jsonPayload.files)) {
        for (const file of jsonPayload.files)
          addIfString(files, file)
      }
      if (Array.isArray(jsonPayload.routes)) {
        for (const route of jsonPayload.routes)
          addIfString(routes, route)
      }
      if (Array.isArray(jsonPayload.warnings))
        warnings.push(...jsonPayload.warnings.filter((w: unknown): w is string => typeof w === 'string'))
      if (Array.isArray(jsonPayload.errors))
        errors.push(...jsonPayload.errors.filter((w: unknown): w is string => typeof w === 'string'))
      if (typeof jsonPayload.filesCount === 'number')
        stats.files = jsonPayload.filesCount
      if (typeof jsonPayload.routesCount === 'number')
        stats.routes = jsonPayload.routesCount
    }

    const routeMatch = trimmed.match(/\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+([/][^\s]+)/i)
    if (routeMatch)
      routes.add(`${routeMatch[1].toUpperCase()} ${routeMatch[2]}`)

    const countMatch = trimmed.match(/(\d+)\s+(routes?|files?)/i)
    if (countMatch) {
      const count = Number(countMatch[1])
      const key = countMatch[2].toLowerCase()
      if (key.startsWith('route'))
        stats.routes = count
      if (key.startsWith('file'))
        stats.files = count
    }

    const fileMatch = extractFilePath(trimmed)
    if (fileMatch)
      files.add(fileMatch)

    if (/\bwarn(ing)?\b/i.test(trimmed))
      warnings.push(trimmed)
    else if (/\b(error|failed|exception|fatal)\b/i.test(trimmed))
      errors.push(trimmed)
    else if (/build|output|emit|generate|write|created|saved/i.test(trimmed))
      notes.push(trimmed)
  }

  return {
    files: Array.from(files),
    routes: Array.from(routes),
    warnings,
    errors,
    notes,
    stats,
    raw: text,
  }
}

function replacePlaceholders(value: string, entry: DetectedEntry): string {
  return value
    .replace(/\{packageRoot\}/g, entry.packageRoot)
    .replace(/\{entryDir\}/g, entry.dir)
    .replace(/\{prefix\}/g, entry.prefix ?? '')
}

function tryParseJsonLine(line: string): Record<string, any> | null {
  if (!line.startsWith('{') || !line.endsWith('}'))
    return null
  try {
    const parsed = JSON.parse(line)
    return parsed && typeof parsed === 'object' ? parsed : null
  }
  catch {
    return null
  }
}

function extractFilePath(line: string): string | null {
  const patterns = [
    /([A-Za-z]:[\\/][^"'`\s]+?\.(ts|js|mjs|cjs|json|jsonc|yaml|yml))/i,
    /(\.{0,2}[\\/][^"'`\s]+?\.(ts|js|mjs|cjs|json|jsonc|yaml|yml))/i,
  ]
  for (const pattern of patterns) {
    const match = line.match(pattern)
    if (match && match[1] && !match[1].startsWith('http'))
      return match[1]
  }
  return null
}

function addIfString(target: Set<string>, value: unknown) {
  if (typeof value === 'string' && value.trim())
    target.add(value)
}
