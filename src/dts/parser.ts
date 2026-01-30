import { Uri, workspace } from 'vscode'
import type { DtsParseResult } from './types'
import { parseDtsSource } from './parse-source'

export async function parseDtsFile(_uri: Uri): Promise<DtsParseResult> {
  const warnings: string[] = []
  const bytes = await workspace.fs.readFile(_uri)
  const text = Buffer.from(bytes).toString('utf8')

  if (!text.trim())
    warnings.push('Empty d.ts file.')

  const result = parseDtsSource(text)
  warnings.push(...result.warnings)

  return {
    schemas: result.schemas,
    warnings,
  }
}
