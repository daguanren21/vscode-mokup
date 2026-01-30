import { Uri, workspace } from 'vscode'
import { parse as parseYaml } from 'yaml'
import type { OpenApiLoadResult } from './types'

export async function loadOpenApiDocument(uri: Uri): Promise<OpenApiLoadResult> {
  const warnings: string[] = []
  const bytes = await workspace.fs.readFile(uri)
  const text = Buffer.from(bytes).toString('utf8')
  const ext = uri.path.split('.').pop()?.toLowerCase() ?? 'json'

  if (ext === 'yaml' || ext === 'yml') {
    try {
      const doc = parseYaml(text) as any
      return {
        doc,
        format: 'yaml',
        warnings,
      }
    }
    catch (error) {
      warnings.push(`YAML parse failed: ${(error as Error).message}`)
      return {
        doc: {},
        format: 'yaml',
        warnings,
      }
    }
  }

  try {
    const doc = JSON.parse(text) as any
    return {
      doc,
      format: 'json',
      warnings,
    }
  }
  catch (error) {
    warnings.push(`JSON parse failed: ${(error as Error).message}`)
    return {
      doc: {},
      format: 'json',
      warnings,
    }
  }
}
