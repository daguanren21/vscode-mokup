import { RelativePattern, Uri, workspace } from 'vscode'
import type { WorkspacePackage, WorkspaceScanResult } from './types'

const VITE_CONFIG_GLOBS = [
  'vite.config.{ts,js,mjs,cjs}',
  'vitest.config.{ts,js,mjs,cjs}',
]

export async function scanWorkspace(): Promise<WorkspaceScanResult | null> {
  const root = workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!root)
    return null

  const warnings: string[] = []
  const mode = workspace.getConfiguration('mokup').get<'auto' | 'on' | 'off'>('workspace.monorepoMode', 'auto')
  const packageRoots = mode === 'off' ? [root] : await detectPackageRoots(root)
  const packages: WorkspacePackage[] = []

  for (const pkgRoot of packageRoots) {
    const configFiles = await findViteConfigFiles(pkgRoot)
    const name = pkgRoot === root ? 'root' : pkgRoot.split(/[\\/]/).pop() || pkgRoot
    packages.push({
      name,
      root: pkgRoot,
      configFiles,
    })
  }

  if (packages.length === 0) {
    warnings.push('No workspace packages detected, fallback to root.')
    packages.push({
      name: 'root',
      root,
      configFiles: await findViteConfigFiles(root),
    })
  }

  return {
    root,
    packages,
    warnings,
  }
}

async function detectPackageRoots(root: string): Promise<string[]> {
  const roots = new Set<string>()
  roots.add(root)

  const pnpm = await readFileIfExists(Uri.file(`${root}/pnpm-workspace.yaml`))
  if (pnpm) {
    const globs = parsePnpmWorkspaceGlobs(pnpm)
    const matches = await expandGlobs(root, globs)
    matches.forEach(m => roots.add(m))
  }

  const pkg = await readJsonIfExists(Uri.file(`${root}/package.json`))
  if (pkg && pkg.workspaces) {
    const globs = parseWorkspacesGlobs(pkg.workspaces)
    const matches = await expandGlobs(root, globs)
    matches.forEach(m => roots.add(m))
  }

  return Array.from(roots)
}

async function findViteConfigFiles(root: string): Promise<string[]> {
  const files: string[] = []
  for (const glob of VITE_CONFIG_GLOBS) {
    const matches = await workspace.findFiles(new RelativePattern(root, glob), '**/node_modules/**', 10)
    matches.forEach(uri => files.push(uri.fsPath))
  }
  return files
}

async function expandGlobs(root: string, globs: string[]): Promise<string[]> {
  const results: string[] = []
  for (const glob of globs) {
    const target = glob.includes('package.json')
      ? glob
      : `${glob.replace(/\/$/, '')}/package.json`
    const matches = await workspace.findFiles(new RelativePattern(root, target), '**/node_modules/**', 200)
    matches.forEach(uri => results.push(uri.fsPath.replace(/[\\/]+package\\.json$/, '')))
  }
  return results
}

function parsePnpmWorkspaceGlobs(content: string): string[] {
  const lines = content.split(/\r?\n/)
  const globs: string[] = []
  let inPackages = false
  for (const line of lines) {
    if (/^\s*packages\s*:/.test(line)) {
      inPackages = true
      continue
    }
    if (inPackages) {
      const match = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/)
      if (match)
        globs.push(match[1])
      else if (/^\S/.test(line))
        break
    }
  }
  return globs
}

function parseWorkspacesGlobs(workspaces: unknown): string[] {
  if (Array.isArray(workspaces))
    return workspaces.filter((w): w is string => typeof w === 'string')

  if (workspaces && typeof workspaces === 'object') {
    const pkg = (workspaces as { packages?: unknown }).packages
    if (Array.isArray(pkg))
      return pkg.filter((w): w is string => typeof w === 'string')
  }
  return []
}

async function readFileIfExists(uri: Uri): Promise<string | null> {
  try {
    const bytes = await workspace.fs.readFile(uri)
    return Buffer.from(bytes).toString('utf8')
  }
  catch {
    return null
  }
}

async function readJsonIfExists(uri: Uri): Promise<any | null> {
  const text = await readFileIfExists(uri)
  if (!text)
    return null
  try {
    return JSON.parse(text)
  }
  catch {
    return null
  }
}
