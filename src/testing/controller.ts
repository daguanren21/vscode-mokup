import path from 'node:path'
import {
  TestMessage,
  TestRunProfileKind,
  Uri,
  ViewColumn,
  window,
  workspace,
  tests,
  type OutputChannel,
  type TestItem,
  type TestRunRequest,
} from 'vscode'
import type { DetectedEntry } from '../scan/collect'
import type { MockRoute } from '../mock/routes'
import { collectWorkspaceEntries } from '../scan/collect'
import { scanMockRoutes } from '../mock/routes'
import { renderCliOutputHtml } from '../preview/cli-output'
import { readRouteFile, renderPreviewHtml } from '../preview/webview'
import { parseCliOutput, runCliBuild } from '../runner/build'
import { checkCliVersion } from '../runner/version'

type ItemData =
  | { type: 'entry', entry: DetectedEntry }
  | { type: 'route', entry: DetectedEntry, route: MockRoute }

export function createMokupTestController(output: OutputChannel) {
  const controller = tests.createTestController('mokup.tests', 'Mokup')
  const itemData = new WeakMap<TestItem, ItemData>()
  const cliVersionChecked = new Map<string, boolean>()

  controller.refreshHandler = async () => {
    await refreshItems(controller, itemData)
  }

  controller.createRunProfile(
    'Build (CLI)',
    TestRunProfileKind.Run,
    request => runBuild(request, controller, itemData, output, cliVersionChecked),
    true,
  )

  controller.createRunProfile(
    'Preview Response',
    TestRunProfileKind.Debug,
    request => runPreview(request, controller, itemData),
    false,
  )

  void refreshItems(controller, itemData)

  return controller
}

async function refreshItems(
  controller: ReturnType<typeof tests.createTestController>,
  itemData: WeakMap<TestItem, ItemData>,
) {
  controller.items.replace([])
  const entries = await collectWorkspaceEntries()
  const routes = await scanMockRoutes(entries)

  for (const entry of entries) {
    const entryId = `entry:${entry.packageRoot}:${entry.dir}:${entry.prefix ?? ''}`
    const label = `${entry.packageName}: ${entry.dir}`
    const entryItem = controller.createTestItem(entryId, label, Uri.file(entry.packageRoot))
    entryItem.description = entry.prefix ? `prefix ${entry.prefix}` : ''
    entryItem.canResolveChildren = false
    itemData.set(entryItem, { type: 'entry', entry })
    controller.items.add(entryItem)

    const entryDir = path.join(entry.packageRoot, entry.dir)
    for (const route of routes.routes.filter(r => r.sourceFile.startsWith(entryDir))) {
      const routeId = `route:${entryId}:${route.method}:${route.path}`
      const routeItem = controller.createTestItem(routeId, `${route.method.toUpperCase()} ${route.path}`, Uri.file(route.sourceFile))
      routeItem.canResolveChildren = false
      entryItem.children.add(routeItem)
      itemData.set(routeItem, { type: 'route', entry, route })
    }
  }
}

async function runBuild(
  request: TestRunRequest,
  controller: ReturnType<typeof tests.createTestController>,
  itemData: WeakMap<TestItem, ItemData>,
  output: OutputChannel,
  cliVersionChecked: Map<string, boolean>,
) {
  const run = controller.createTestRun(request)
  const items = collectItems(request, controller)
  const entries = new Map<string, { item: TestItem, entry: DetectedEntry }>()

  for (const item of items) {
    const data = itemData.get(item)
    if (!data)
      continue
    if (data.type === 'entry') {
      entries.set(data.entry.packageRoot, { item, entry: data.entry })
    }
    if (data.type === 'route') {
      const key = data.entry.packageRoot
      if (!entries.has(key)) {
        const entryItem = findEntryItem(controller, data.entry)
        if (entryItem)
          entries.set(key, { item: entryItem, entry: data.entry })
      }
    }
  }

  for (const { item, entry } of entries.values()) {
    run.started(item)
    const config = workspace.getConfiguration('mokup')
    const command = config.get<string>('build.command', config.get('runner.command', 'mokup'))
    const mode = config.get<'server' | 'sw'>('runner.mode', 'server')
    let args = config.get<string[]>('build.args', ['build'])
    args = applyRunnerMode(args, mode)

    await checkCliVersionOnce(command, entry.packageRoot, cliVersionChecked)
    const result = await runCliBuild(entry, command, args, output)
    const parsed = parseCliOutput(result.combined)

    const panel = window.createWebviewPanel(
      'mokup.build.preview',
      `Mokup Build Output: ${entry.packageName}`,
      { viewColumn: getPreferredViewColumn(), preserveFocus: true },
      { enableScripts: false },
    )
    panel.webview.html = renderCliOutputHtml({
      title: `Build Output - ${entry.packageName}`,
      commandLine: `${command} ${result.args.join(' ')}`,
      cwd: result.cwd,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      parsed,
    })

    const failed = result.exitCode !== 0 || parsed.errors.length > 0
    if (failed) {
      const message = new TestMessage(parsed.errors.join('\n') || `build exit code ${result.exitCode ?? 'null'}`)
      run.failed(item, message)
    }
    else {
      run.passed(item)
    }
  }

  run.end()
}

async function runPreview(
  request: TestRunRequest,
  controller: ReturnType<typeof tests.createTestController>,
  itemData: WeakMap<TestItem, ItemData>,
) {
  const run = controller.createTestRun(request)
  const items = collectItems(request, controller)

  for (const item of items) {
    const data = itemData.get(item)
    if (!data || data.type !== 'route') {
      run.skipped(item)
      continue
    }
    run.started(item)
    const panel = window.createWebviewPanel(
      'mokup.preview',
      `Mokup Preview: ${data.route.method.toUpperCase()} ${data.route.path}`,
      { viewColumn: getPreferredViewColumn(), preserveFocus: true },
      { enableScripts: false },
    )
    const content = await readRouteFile(data.route.sourceFile)
    panel.webview.html = renderPreviewHtml(data.route, content)
    run.passed(item)
  }

  run.end()
}

function collectItems(request: TestRunRequest, controller: ReturnType<typeof tests.createTestController>): TestItem[] {
  const included = request.include ? Array.from(request.include) : collectAllItems(controller.items)
  if (!request.exclude?.length)
    return included
  const excluded = new Set(request.exclude)
  return included.filter(item => !excluded.has(item))
}

function collectAllItems(collection: ReturnType<typeof tests.createTestController>['items']): TestItem[] {
  const items: TestItem[] = []
  collection.forEach((item) => {
    items.push(item)
    if (item.children.size > 0)
      items.push(...collectAllItems(item.children))
  })
  return items
}

function findEntryItem(
  controller: ReturnType<typeof tests.createTestController>,
  entry: DetectedEntry,
): TestItem | undefined {
  let found: TestItem | undefined
  controller.items.forEach((item) => {
    if (found)
      return
    const uri = item.uri?.fsPath
    if (uri && uri === entry.packageRoot)
      found = item
  })
  return undefined
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

function getPreferredViewColumn(): ViewColumn {
  return window.activeTextEditor?.viewColumn ?? ViewColumn.One
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
