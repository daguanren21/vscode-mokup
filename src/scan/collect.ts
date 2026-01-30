import { Uri, workspace } from 'vscode'
import type { MokupEntry } from './entries'
import { detectEntriesFromConfigFiles } from './entries'
import { scanWorkspace } from './workspace'

export type DetectedEntry = MokupEntry & {
  packageName: string
  packageRoot: string
  source: 'vite-config' | 'fallback'
}

export async function collectWorkspaceEntries(): Promise<DetectedEntry[]> {
  const result = await scanWorkspace()
  if (!result)
    return []

  const detected: DetectedEntry[] = []
  const preferVite = workspace.getConfiguration('mokup').get<boolean>('entries.preferViteConfig', true)

  for (const pkg of result.packages) {
    const entries = await detectEntriesFromConfigFiles(pkg.configFiles, async (path) => {
      try {
        const bytes = await workspace.fs.readFile(Uri.file(path))
        return Buffer.from(bytes).toString('utf8')
      }
      catch {
        return null
      }
    })

    const fallback = await detectDefaultEntry(pkg.root)
    const hasViteEntries = entries.entries.length > 0
    const useVite = preferVite ? hasViteEntries : !fallback

    if (useVite && hasViteEntries) {
      for (const entry of entries.entries) {
        detected.push({
          ...entry,
          packageName: pkg.name,
          packageRoot: pkg.root,
          source: 'vite-config',
        })
      }
      continue
    }

    if (fallback) {
      detected.push({
        ...fallback,
        packageName: pkg.name,
        packageRoot: pkg.root,
        source: 'fallback',
      })
    }
    else if (hasViteEntries) {
      for (const entry of entries.entries) {
        detected.push({
          ...entry,
          packageName: pkg.name,
          packageRoot: pkg.root,
          source: 'vite-config',
        })
      }
    }
  }

  return detected
}

async function detectDefaultEntry(root: string): Promise<MokupEntry | null> {
  const mockDir = Uri.file(`${root}/mock`)
  try {
    const stat = await workspace.fs.stat(mockDir)
    if (stat.type & 2)
      return { dir: 'mock' }
  }
  catch {
    return null
  }
  return null
}
