import path from 'node:path'
import { RelativePattern, workspace } from 'vscode'
import type { DetectedEntry } from '../scan/collect'

export type MockRoute = {
  method: string
  path: string
  sourceFile: string
}

export type MockRouteScanResult = {
  routes: MockRoute[]
  warnings: string[]
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']
const EXTENSIONS = ['ts', 'js', 'mjs', 'cjs', 'json', 'jsonc']

export async function scanMockRoutes(entries: DetectedEntry[]): Promise<MockRouteScanResult> {
  const routes: MockRoute[] = []
  const warnings: string[] = []

  for (const entry of entries) {
    const entryDir = path.join(entry.packageRoot, entry.dir)
    const globs = METHODS.map(method => `**/*.${method}.{${EXTENSIONS.join(',')}}`)
    for (const glob of globs) {
      const matches = await workspace.findFiles(new RelativePattern(entryDir, glob), '**/node_modules/**', 5000)
      for (const uri of matches) {
        const route = routeFromFile(uri.fsPath, entryDir, entry.prefix)
        if (!route) {
          warnings.push(`Failed to parse route from ${uri.fsPath}`)
          continue
        }
        routes.push(route)
      }
    }
  }

  return { routes, warnings }
}

function routeFromFile(filePath: string, entryDir: string, prefix?: string): MockRoute | null {
  const rel = path.relative(entryDir, filePath)
  const ext = path.extname(rel)
  const base = rel.slice(0, -ext.length)
  const parts = base.split(/[\\/]/)
  const last = parts.pop() || ''
  const match = last.match(/^(.*)\.(get|post|put|patch|delete|head|options|trace)$/)
  if (!match)
    return null
  const name = match[1]
  const method = match[2]
  const segments = name === 'index' ? parts : [...parts, name]
  const pathValue = buildPath(segments, prefix)
  return {
    method,
    path: pathValue === '/' ? '/' : pathValue.replace(/\/+$/, ''),
    sourceFile: filePath,
  }
}

function toRouteSegment(segment: string): string {
  const match = segment.match(/^\[(\.\.\.)?(.+)\]$/)
  if (match)
    return `{${match[2]}}`
  return segment
}

function buildPath(segments: string[], prefix?: string): string {
  const base = `/${segments.map(seg => toRouteSegment(seg)).filter(Boolean).join('/')}`
  const normalizedPrefix = prefix ? (prefix.startsWith('/') ? prefix : `/${prefix}`) : ''
  if (!normalizedPrefix)
    return base === '/' ? '/' : base
  if (base === '/')
    return normalizedPrefix || '/'
  return `${normalizedPrefix}${base}`
}
