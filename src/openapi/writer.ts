import path from 'node:path'
import { FileType, Uri, window, workspace } from 'vscode'
import type { MockWritePlan } from './plan'

export type MockWriteConflictStrategy = 'overwrite' | 'skip' | 'backup' | 'prompt'

export type WriteMockOptions = {
  conflict?: MockWriteConflictStrategy
}

export async function writeMockFiles(plan: MockWritePlan[], options: WriteMockOptions = {}): Promise<void> {
  let applyAll: MockWriteConflictStrategy | null = null
  const defaultConflict = options.conflict ?? 'overwrite'
  for (const file of plan) {
    await workspace.fs.createDirectory(Uri.file(path.dirname(file.path)))
    const exists = await fileExists(file.path)
    let strategy = applyAll ?? defaultConflict

    if (exists) {
      if (strategy === 'prompt') {
        const picked = await window.showQuickPick([
          { label: 'Overwrite', action: 'overwrite' },
          { label: 'Skip', action: 'skip' },
          { label: 'Backup', action: 'backup' },
          { label: 'Overwrite All', action: 'overwriteAll' },
          { label: 'Skip All', action: 'skipAll' },
          { label: 'Backup All', action: 'backupAll' },
          { label: 'Cancel', action: 'cancel' },
        ], { placeHolder: `File exists: ${file.path}` })
        if (!picked || picked.action === 'cancel')
          return
        if (picked.action === 'overwriteAll') {
          applyAll = 'overwrite'
          strategy = 'overwrite'
        }
        else if (picked.action === 'skipAll') {
          applyAll = 'skip'
          strategy = 'skip'
        }
        else if (picked.action === 'backupAll') {
          applyAll = 'backup'
          strategy = 'backup'
        }
        else {
          strategy = picked.action as MockWriteConflictStrategy
        }
      }

      if (strategy === 'skip')
        continue
      if (strategy === 'backup')
        await backupFile(file.path)
    }

    await workspace.fs.writeFile(Uri.file(file.path), Buffer.from(file.content, 'utf8'))
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await workspace.fs.stat(Uri.file(filePath))
    return (stat.type & FileType.File) !== 0
  }
  catch {
    return false
  }
}

async function backupFile(filePath: string): Promise<void> {
  const source = Uri.file(filePath)
  const bytes = await workspace.fs.readFile(source)
  const backupPath = await nextBackupPath(filePath)
  await workspace.fs.writeFile(Uri.file(backupPath), bytes)
}

async function nextBackupPath(filePath: string): Promise<string> {
  const base = `${filePath}.bak`
  if (!await fileExists(base))
    return base
  for (let i = 2; i < 1000; i++) {
    const candidate = `${filePath}.bak${i}`
    if (!await fileExists(candidate))
      return candidate
  }
  return `${filePath}.bak${Date.now()}`
}
