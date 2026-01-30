import { RelativePattern, Uri, workspace } from 'vscode'

export async function scanOpenApiFiles(): Promise<Uri[]> {
  const config = workspace.getConfiguration('mokup')
  const globs = config.get<string[]>('openapi.scanGlobs', ['**/*.{yaml,yml,json}'])
  return scanWorkspaceFiles(globs)
}

async function scanWorkspaceFiles(globs: string[]): Promise<Uri[]> {
  const folders = workspace.workspaceFolders ?? []
  if (folders.length === 0 || globs.length === 0)
    return []
  const found = new Map<string, Uri>()
  const exclude = '**/node_modules/**'
  for (const folder of folders) {
    for (const glob of globs) {
      const matches = await workspace.findFiles(new RelativePattern(folder, glob), exclude, 2000)
      for (const uri of matches)
        found.set(uri.fsPath, uri)
    }
  }
  return Array.from(found.values()).sort((a, b) => {
    const aPath = workspace.asRelativePath(a)
    const bPath = workspace.asRelativePath(b)
    return aPath.localeCompare(bPath)
  })
}
