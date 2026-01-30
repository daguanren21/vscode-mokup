import { defineExtension } from 'reactive-vscode'
import path from 'node:path'
import { StatusBarAlignment, Uri, ViewColumn, commands, env, window, workspace } from 'vscode'
import { stringify as stringifyYaml } from 'yaml'
import { detectOpenApiVersion, normalizeOpenApiDocument } from './openapi/compat'
import { exportMokupToOpenApi } from './openapi/exporter'
import { mapOpenApiToMokup, type MokupRoute } from './openapi/mapper'
import { planMockWritesForEntry } from './openapi/plan'
import { scanOpenApiFiles } from './openapi/scan'
import { writeMockFiles } from './openapi/writer'
import { loadOpenApiDocument } from './openapi/loader'
import { planMockWritesForSchemas } from './dts/mock'
import { parseDtsFile } from './dts/parser'
import { scanDtsFiles } from './dts/scan'
import { scanMockRoutes, type MockRoute } from './mock/routes'
import { readRouteFile, renderPreviewHtml } from './preview/webview'
import { MokupRoutesProvider } from './tree/provider'
import { MokupRunner } from './runner/manager'
import { createMokupTestController } from './testing/controller'
import { checkCliVersion } from './runner/version'
import { detectEntriesFromConfigFiles } from './scan/entries'
import { collectWorkspaceEntries, type DetectedEntry } from './scan/collect'
import { scanWorkspace } from './scan/workspace'

const { activate, deactivate } = defineExtension(() => {
  const register = (id: string, handler: () => void) =>
    commands.registerCommand(id, handler)

  const output = window.createOutputChannel('Mokup')
  const runner = new MokupRunner(output)
  const cliVersionChecked = new Map<string, boolean>()
  const status = window.createStatusBarItem(StatusBarAlignment.Left, 100)
  status.text = 'Mokup: idle'
  status.command = 'mokup.startMock'
  status.show()

  const updateStatus = () => {
    const running = runner.getRunningEntries()
    if (running.length === 0) {
      status.text = 'Mokup: idle'
      status.tooltip = 'Start mokup'
      status.command = 'mokup.startMock'
      return
    }
    if (running.length === 1) {
      const record = running[0]
      const port = record.port ? `:${record.port}` : ''
      status.text = `Mokup: ${record.entry.packageName}${port}`
      status.tooltip = record.entry.packageRoot
      status.command = 'mokup.stopMock'
      return
    }
    status.text = `Mokup: ${running.length} running`
    status.tooltip = 'Stop all mokup instances'
    status.command = 'mokup.stopAll'
  }
  runner.onDidUpdate(updateStatus)
  updateStatus()
  const routesProvider = new MokupRoutesProvider()
  const routesView = window.createTreeView('mokup.routes', { treeDataProvider: routesProvider })
  const testController = createMokupTestController(output)

  const subscriptions = [
    output,
    status,
    routesView,
    testController,
    register('mokup.importOpenAPI', async () => {
      const picked = await pickOpenApiFiles()
      if (!picked.length)
        return

      const warnings: string[] = []
      const routes: MokupRoute[] = []
      const schemaNames = new Set<string>()
      const versions = new Set<string>()

      for (const uri of picked) {
        const result = await loadOpenApiDocument(uri)
        const normalized = normalizeOpenApiDocument(result.doc)
        const version = detectOpenApiVersion(result.doc)
        versions.add(version)
        const mapping = mapOpenApiToMokup(normalized.doc)
        const label = workspace.asRelativePath(uri)
        warnings.push(
          ...result.warnings.map(w => `${label}: ${w}`),
          ...normalized.warnings.map(w => `${label}: ${w}`),
          ...mapping.warnings.map(w => `${label}: ${w}`),
        )
        routes.push(...mapping.routes)
        for (const name of Object.keys(mapping.schemas))
          schemaNames.add(name)
      }
      const entries = await collectWorkspaceEntries()
      let selected: DetectedEntry | undefined = entries[0]
      if (entries.length > 1) {
        const pick = await window.showQuickPick(entries.map(entry => ({
          label: `${entry.packageName}: ${entry.dir}`,
          description: entry.prefix ? `prefix ${entry.prefix}` : '',
          detail: entry.source,
          entry,
        })))
        selected = pick?.entry
      }

      if (!selected) {
        window.showWarningMessage('Mokup: no entries detected, skip writing mock files.')
      }
      else {
        const config = workspace.getConfiguration('mokup')
        const format = config.get<'ts' | 'json'>('openapi.import.format', 'ts')
        const shouldWrite = config.get<boolean>('openapi.import.writeFiles', true)
        const conflict = config.get<'overwrite' | 'skip' | 'backup' | 'prompt'>('openapi.import.conflict', 'prompt')
        const tsTemplate = await loadTemplate(
          config.get<string>('openapi.import.tsTemplate', ''),
          config.get<string>('openapi.import.tsTemplatePath', ''),
          warnings,
        )
        const jsonTemplate = await loadTemplate(
          config.get<string>('openapi.import.jsonTemplate', ''),
          config.get<string>('openapi.import.jsonTemplatePath', ''),
          warnings,
        )
        const plan = planMockWritesForEntry(routes, selected, selected.packageRoot, {
          format,
          tsTemplate,
          jsonTemplate,
        })
        warnings.push(...plan.warnings)
        if (shouldWrite)
          await writeMockFiles(plan.files, { conflict })
        else
          warnings.push('Mock file writing is disabled (mokup.openapi.import.writeFiles=false).')
      }
      const versionLabel = versions.size === 1 ? Array.from(versions)[0] : 'mixed'
      const message = warnings.length > 0
        ? `Mokup: loaded OpenAPI ${versionLabel} (${routes.length} routes, ${schemaNames.size} schemas) with ${warnings.length} warning(s)`
        : `Mokup: loaded OpenAPI ${versionLabel} (${routes.length} routes, ${schemaNames.size} schemas)`

      window.showInformationMessage(message)
    }),
    register('mokup.exportOpenAPI', () => {
      void (async () => {
        const metadataChoice = await window.showQuickPick([
          { label: 'Use existing OpenAPI file as base', value: 'base' },
          { label: 'Use default metadata', value: 'default' },
        ], { placeHolder: 'OpenAPI export: metadata source' })

        let baseDoc: any | undefined
        let mergeStrategy: 'merge' | 'overwrite' = 'merge'
        if (metadataChoice?.value === 'base') {
          const basePicked = await window.showOpenDialog({
            canSelectMany: false,
            filters: {
              OpenAPI: ['yaml', 'yml', 'json'],
            },
          })
          if (basePicked?.length) {
            const loaded = await loadOpenApiDocument(basePicked[0])
            baseDoc = loaded.doc
          }
          const mergeOptions = [
            { label: 'Merge (keep existing)', value: 'merge' as const },
            { label: 'Overwrite', value: 'overwrite' as const },
          ]
          const strategyPick = await window.showQuickPick(
            mergeOptions,
            { placeHolder: 'OpenAPI export: merge strategy' },
          )
          mergeStrategy = strategyPick?.value ?? 'merge'
        }

        const entries = await collectWorkspaceEntries()
        const routeScan = await scanMockRoutes(entries)

        let schemaMap: Record<string, unknown> = {}
        const schemaChoice = await window.showQuickPick([
          { label: 'Include schemas from d.ts', value: 'dts' },
          { label: 'Skip schemas', value: 'skip' },
        ], { placeHolder: 'OpenAPI export: schema source' })
        if (schemaChoice?.value === 'dts') {
          const dtsPicked = await window.showOpenDialog({
            canSelectMany: false,
            filters: {
              DTS: ['d.ts'],
            },
          })
          if (dtsPicked?.length) {
            const parsed = await parseDtsFile(dtsPicked[0])
            schemaMap = parsed.schemas
          }
        }
        const picked = await window.showSaveDialog({
          filters: {
            OpenAPI: ['json', 'yaml', 'yml'],
          },
          saveLabel: 'Export OpenAPI',
        })
        if (!picked)
          return

        const doc = exportMokupToOpenApi({
          base: baseDoc,
          routes: routeScan.routes,
          schemas: schemaMap,
          mergeStrategy,
        })
        const ext = path.extname(picked.fsPath).toLowerCase()
        const text = ext === '.yaml' || ext === '.yml'
          ? stringifyYaml(doc)
          : JSON.stringify(doc, null, 2)
        await workspace.fs.writeFile(picked, Buffer.from(text, 'utf8'))
        const warnSuffix = routeScan.warnings.length > 0
          ? ` with ${routeScan.warnings.length} warning(s)`
          : ''
        window.showInformationMessage(`Mokup: OpenAPI exported (${routeScan.routes.length} routes)${warnSuffix}`)
      })()
    }),
    register('mokup.importDts', async () => {
      const picked = await pickDtsFiles()
      if (!picked.length)
        return

      const warnings: string[] = []
      const schemas: Record<string, unknown> = {}
      for (const uri of picked) {
        const result = await parseDtsFile(uri)
        const label = workspace.asRelativePath(uri)
        warnings.push(...result.warnings.map(w => `${label}: ${w}`))
        for (const [name, schema] of Object.entries(result.schemas)) {
          if (schemas[name])
            warnings.push(`${label}: schema ${name} overrides an existing definition`)
          schemas[name] = schema
        }
      }

      const schemaCount = Object.keys(schemas).length
      if (schemaCount === 0) {
        const message = warnings.length > 0
          ? `Mokup: parsed d.ts (0 schemas) with ${warnings.length} warning(s)`
          : 'Mokup: parsed d.ts (0 schemas)'
        window.showInformationMessage(message)
        return
      }

      const entries = await collectWorkspaceEntries()
      let selected: DetectedEntry | undefined = entries[0]
      if (entries.length > 1) {
        const pick = await window.showQuickPick(entries.map(entry => ({
          label: `${entry.packageName}: ${entry.dir}`,
          description: entry.prefix ? `prefix ${entry.prefix}` : '',
          detail: entry.source,
          entry,
        })), { placeHolder: 'Select entry to write mock files' })
        selected = pick?.entry
      }
      if (!selected) {
        window.showWarningMessage('Mokup: no entries detected, skip writing mock files.')
        const message = warnings.length > 0
          ? `Mokup: parsed d.ts (${schemaCount} schemas) with ${warnings.length} warning(s)`
          : `Mokup: parsed d.ts (${schemaCount} schemas)`
        window.showInformationMessage(message)
        return
      }

      const methodPick = await window.showQuickPick(
        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        { placeHolder: 'Mock routes method for schemas' },
      )
      if (!methodPick) {
        window.showInformationMessage('Mokup: schema mock generation canceled.')
        return
      }
      const basePath = await window.showInputBox({
        prompt: 'Base path for schema mock routes',
        value: '/schema',
      })
      if (basePath === undefined) {
        window.showInformationMessage('Mokup: schema mock generation canceled.')
        return
      }

      const config = workspace.getConfiguration('mokup')
      const format = config.get<'ts' | 'json'>('openapi.import.format', 'ts')
      const shouldWrite = config.get<boolean>('openapi.import.writeFiles', true)
      const conflict = config.get<'overwrite' | 'skip' | 'backup' | 'prompt'>('openapi.import.conflict', 'prompt')
      const tsTemplate = await loadTemplate(
        config.get<string>('openapi.import.tsTemplate', ''),
        config.get<string>('openapi.import.tsTemplatePath', ''),
        warnings,
      )
      const jsonTemplate = await loadTemplate(
        config.get<string>('openapi.import.jsonTemplate', ''),
        config.get<string>('openapi.import.jsonTemplatePath', ''),
        warnings,
      )
      const plan = planMockWritesForSchemas(schemas, selected, selected.packageRoot, {
        format,
        tsTemplate,
        jsonTemplate,
        method: methodPick,
        basePath,
      })
      warnings.push(...plan.warnings)
      if (shouldWrite)
        await writeMockFiles(plan.files, { conflict })
      else
        warnings.push('Mock file writing is disabled (mokup.openapi.import.writeFiles=false).')

      const message = warnings.length > 0
        ? `Mokup: parsed d.ts (${schemaCount} schemas), generated ${plan.files.length} mock file(s) with ${warnings.length} warning(s)`
        : `Mokup: parsed d.ts (${schemaCount} schemas), generated ${plan.files.length} mock file(s)`
      window.showInformationMessage(message)
    }),
    register('mokup.rescanWorkspace', async () => {
      const result = await scanWorkspace()
      if (!result) {
        window.showWarningMessage('Mokup: No workspace folder found')
        return
      }
      const pkgCount = result.packages.length
      const configCount = result.packages.reduce((sum, p) => sum + p.configFiles.length, 0)
      let entriesCount = 0

      for (const pkg of result.packages) {
        const detected = await detectEntriesFromConfigFiles(pkg.configFiles, async (path) => {
          try {
            const bytes = await workspace.fs.readFile(Uri.file(path))
            return Buffer.from(bytes).toString('utf8')
          }
          catch {
            return null
          }
        })
        entriesCount += detected.entries.length
      }

      window.showInformationMessage(`Mokup: scanned ${pkgCount} package(s), ${configCount} config file(s), ${entriesCount} entries`)
      routesProvider.refresh()
    }),
    register('mokup.startMock', () => {
      void (async () => {
        const entry = await pickEntry()
        if (!entry)
          return
        const config = workspace.getConfiguration('mokup')
        const command = config.get<string>('runner.command', 'mokup')
        const args = applyRunnerMode(
          config.get<string[]>('runner.args', []),
          config.get<'server' | 'sw'>('runner.mode', 'server'),
        )
        await checkCliVersionOnce(command, entry.packageRoot, cliVersionChecked)
        output.show(true)
        runner.start(entry, command, args)
      })()
    }),
    register('mokup.startAll', () => {
      void (async () => {
        const entries = await collectWorkspaceEntries()
        if (entries.length === 0) {
          window.showWarningMessage('Mokup: no entries detected')
          return
        }
        const config = workspace.getConfiguration('mokup')
        const command = config.get<string>('runner.command', 'mokup')
        const args = applyRunnerMode(
          config.get<string[]>('runner.args', []),
          config.get<'server' | 'sw'>('runner.mode', 'server'),
        )
        await checkCliVersionOnce(command, entries[0]?.packageRoot ?? '', cliVersionChecked)
        output.show(true)
        for (const entry of entries)
          runner.start(entry, command, args)
      })()
    }),
    register('mokup.stopMock', () => {
      void (async () => {
        const entry = await pickEntry()
        if (!entry)
          return
        runner.stop(entry)
      })()
    }),
    register('mokup.stopAll', () => {
      runner.stopAll()
    }),
    register('mokup.showRunners', async () => {
      const running = runner.getRunningEntries()
      if (running.length === 0) {
        window.showInformationMessage('Mokup: no running instances')
        return
      }
      const picked = await window.showQuickPick(running.map(record => ({
        label: `${record.entry.packageName}: ${record.entry.dir}`,
        description: record.port ? `http://localhost:${record.port}` : 'port unknown',
        detail: record.entry.packageRoot,
        record,
      })), { placeHolder: 'Running mokup instances' })
      if (!picked)
        return
      if (picked.record.port)
        void env.openExternal(Uri.parse(`http://localhost:${picked.record.port}`))
    }),
    register('mokup.previewTemplate', async () => {
      const entry = await pickEntry()
      if (!entry)
        return
      const method = await window.showQuickPick(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], { placeHolder: 'HTTP method' })
      if (!method)
        return
      const pathValue = await window.showInputBox({ prompt: 'Route path', value: '/api/example' })
      if (!pathValue)
        return
      const config = workspace.getConfiguration('mokup')
      const format = config.get<'ts' | 'json'>('openapi.import.format', 'ts')
      const warnings: string[] = []
      const tsTemplate = await loadTemplate(
        config.get<string>('openapi.import.tsTemplate', ''),
        config.get<string>('openapi.import.tsTemplatePath', ''),
        warnings,
      )
      const jsonTemplate = await loadTemplate(
        config.get<string>('openapi.import.jsonTemplate', ''),
        config.get<string>('openapi.import.jsonTemplatePath', ''),
        warnings,
      )
      const plan = planMockWritesForEntry(
        [{ method: method.toLowerCase(), path: pathValue }],
        entry,
        entry.packageRoot,
        { format, tsTemplate, jsonTemplate },
      )
      const content = plan.files[0]?.content ?? ''
      const route: MockRoute = {
        method: method.toLowerCase(),
        path: pathValue,
        sourceFile: '(template preview)',
      }
      const panel = window.createWebviewPanel(
        'mokup.preview.template',
        `Mokup Template Preview: ${method} ${pathValue}`,
        { viewColumn: getPreferredViewColumn(), preserveFocus: true },
        { enableScripts: false },
      )
      panel.webview.html = renderPreviewHtml(route, content)
    }),
    register('mokup.previewMock', async (routeArg?: MockRoute) => {
      const route = routeArg ?? await pickRouteForPreview()
      if (!route)
        return
      await previewRoute(route, 'mokup.preview', 'Mokup Preview')
    }),
    register('mokup.routes.refresh', () => {
      routesProvider.refresh()
    }),
    register('mokup.routes.previewSelected', async () => {
      const selected = routesView.selection[0]
      if (selected && 'route' in selected) {
        await previewRoute(selected.route, 'mokup.preview', 'Mokup Preview')
        return
      }
      const route = await pickRouteForPreview()
      if (route)
        await previewRoute(route, 'mokup.preview', 'Mokup Preview')
    }),
  ]

  return {
    dispose() {
      subscriptions.forEach(s => s.dispose())
    },
  }
})

async function pickRouteForPreview(): Promise<MockRoute | undefined> {
  const entries = await collectWorkspaceEntries()
  const scan = await scanMockRoutes(entries)
  if (scan.routes.length === 0) {
    window.showWarningMessage('Mokup: no mock routes found')
    return undefined
  }
  const picked = await window.showQuickPick(scan.routes.map(route => ({
    label: `${route.method.toUpperCase()} ${route.path}`,
    description: route.sourceFile,
    route,
  })), { placeHolder: 'Select a mock route to preview' })
  return picked?.route
}

async function previewRoute(route: MockRoute, viewType: string, titlePrefix: string) {
  const panel = window.createWebviewPanel(
    viewType,
    `${titlePrefix}: ${route.method.toUpperCase()} ${route.path}`,
    { viewColumn: getPreferredViewColumn(), preserveFocus: true },
    { enableScripts: false },
  )
  const content = await readRouteFile(route.sourceFile)
  panel.webview.html = renderPreviewHtml(route, content)
}

async function pickEntry() {
  const entries = await collectWorkspaceEntries()
  if (entries.length === 0) {
    window.showWarningMessage('Mokup: no entries detected')
    return undefined
  }
  if (entries.length === 1)
    return entries[0]
  const picked = await window.showQuickPick(entries.map(entry => ({
    label: `${entry.packageName}: ${entry.dir}`,
    description: entry.prefix ? `prefix ${entry.prefix}` : '',
    detail: entry.source,
    entry,
  })), { placeHolder: 'Select entry to run' })
  return picked?.entry
}

function getPreferredViewColumn(): ViewColumn {
  return window.activeTextEditor?.viewColumn ?? ViewColumn.One
}

function applyRunnerMode(args: string[], mode: 'server' | 'sw'): string[] {
  if (mode !== 'sw')
    return args
  const hasMode = args.some((arg, idx) => {
    if (arg === '--mode')
      return true
    if (arg.startsWith('--mode='))
      return true
    if (arg === '--mode' && typeof args[idx + 1] === 'string')
      return true
    return false
  })
  if (hasMode)
    return args
  return [...args, '--mode', 'sw']
}

async function checkCliVersionOnce(
  command: string,
  cwd: string,
  cache: Map<string, boolean>,
): Promise<void> {
  if (cache.has(command))
    return
  const result = await checkCliVersion(command, cwd || (workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()))
  cache.set(command, result.ok)
  if (!result.ok) {
    const message = result.output.trim()
      ? `Mokup: failed to run "${command} --version". ${result.output.trim()}`
      : `Mokup: failed to run "${command} --version".`
    window.showWarningMessage(message)
  }
}

async function loadTemplate(inline: string, templatePath: string, warnings: string[]): Promise<string | undefined> {
  if (inline?.trim())
    return inline
  if (!templatePath?.trim())
    return undefined
  const root = workspace.workspaceFolders?.[0]?.uri.fsPath
  const resolved = path.isAbsolute(templatePath)
    ? templatePath
    : root
      ? path.join(root, templatePath)
      : templatePath
  try {
    const bytes = await workspace.fs.readFile(Uri.file(resolved))
    return Buffer.from(bytes).toString('utf8')
  }
  catch {
    warnings.push(`Failed to read template: ${resolved}`)
    return undefined
  }
}

type FilePickItem = {
  label: string
  description?: string
  detail?: string
  uri?: Uri
  action?: 'browse'
}

async function pickOpenApiFiles(): Promise<Uri[]> {
  const scanned = await scanOpenApiFiles()
  return pickFilesFromScan('OpenAPI', scanned, {
    OpenAPI: ['yaml', 'yml', 'json'],
  })
}

async function pickDtsFiles(): Promise<Uri[]> {
  const scanned = await scanDtsFiles()
  return pickFilesFromScan('DTS', scanned, {
    DTS: ['d.ts'],
  })
}

async function pickFilesFromScan(
  kind: string,
  scanned: Uri[],
  filters: Record<string, string[]>,
): Promise<Uri[]> {
  if (scanned.length > 0) {
    const items: FilePickItem[] = [
      { label: 'Browse...', description: `Select ${kind} files manually`, action: 'browse' },
      ...scanned.map(uri => ({
        label: workspace.asRelativePath(uri),
        description: path.basename(uri.fsPath),
        uri,
      })),
    ]
    const picked = await window.showQuickPick<FilePickItem>(
      items,
      { canPickMany: true, placeHolder: `Select ${kind} files` },
    )
    if (!picked)
      return []
    const selected = picked.filter(item => item.uri).map(item => item.uri!) ?? []
    const wantsBrowse = picked.some(item => item.action === 'browse')
    if (wantsBrowse || selected.length === 0) {
      const dialog = await window.showOpenDialog({
        canSelectMany: true,
        filters,
      })
      return uniqueUris([...(selected ?? []), ...(dialog ?? [])])
    }
    return uniqueUris(selected)
  }

  const fallback = await window.showOpenDialog({
    canSelectMany: true,
    filters,
  })
  return fallback ? uniqueUris(fallback) : []
}

function uniqueUris(uris: Uri[]): Uri[] {
  const seen = new Map<string, Uri>()
  for (const uri of uris)
    seen.set(uri.fsPath, uri)
  return Array.from(seen.values())
}

export { activate, deactivate }
