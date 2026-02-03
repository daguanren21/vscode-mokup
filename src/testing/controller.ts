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
import { readRouteFile, renderRequestPreviewHtml } from '../preview/webview'
import { handlePreviewRequestMessage } from '../preview/request'
import { MokupRunner } from '../runner/manager'
import { parseCliOutput, runCliBuild } from '../runner/build'
import { checkCliVersion } from '../runner/version'
import { resolveBuildCommand, resolveRunnerCommand } from '../runner/resolve'

type ItemData =
  | { type: 'entry', entry: DetectedEntry }
  | { type: 'route', entry: DetectedEntry, route: MockRoute }

export function createMokupTestController(
  output: OutputChannel,
  runner?: MokupRunner,
  runnerVersionChecked?: Map<string, boolean>,
) {
  const controller = tests.createTestController('mokup.tests', 'Mokup')
  const itemData = new WeakMap<TestItem, ItemData>()
  const cliVersionChecked = new Map<string, boolean>()
  const runnerVersionCache = runnerVersionChecked ?? new Map<string, boolean>()

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
    request => runPreview(request, controller, itemData, runner, runnerVersionCache),
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
    const resolved = await resolveBuildCommand(entry, config)
    await checkCliVersionOnce(resolved.command, resolved.versionArgs, entry.packageRoot, cliVersionChecked)
    const result = await runCliBuild(entry, resolved.command, resolved.args, output)
    const parsed = parseCliOutput(result.combined)

    const panel = window.createWebviewPanel(
      'mokup.build.preview',
      `Mokup Build Output: ${entry.packageName}`,
      { viewColumn: getPreferredViewColumn(), preserveFocus: true },
      { enableScripts: false },
    )
    panel.webview.html = renderCliOutputHtml({
      title: `Build Output - ${entry.packageName}`,
      commandLine: `${resolved.command} ${result.args.join(' ')}`,
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
  runner: MokupRunner | undefined,
  runnerVersionCache: Map<string, boolean>,
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
      { enableScripts: true },
    )
    const content = await readRouteFile(data.route.sourceFile)
    const baseUrl = resolveBaseUrl(data.entry, runner)
    panel.webview.html = renderRequestPreviewHtml(data.route, content, {
      cspSource: panel.webview.cspSource,
      baseUrl,
      instanceLabel: `${data.entry.packageName}: ${data.entry.dir}`,
    })
    panel.webview.onDidReceiveMessage(async (message) => {
      if (await handleEnsureMockMessage(panel, message, data.entry, runner, runnerVersionCache))
        return
      await handlePreviewRequestMessage(panel, message)
    })
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

function getPreferredViewColumn(): ViewColumn {
  return window.activeTextEditor?.viewColumn ?? ViewColumn.One
}

function resolveBaseUrl(entry: DetectedEntry, runner?: MokupRunner): string | undefined {
  if (!runner)
    return undefined
  const record = runner.getRunningEntries().find(item => item.entry.packageRoot === entry.packageRoot)
  if (!record?.port)
    return undefined
  const host = record.host ?? 'localhost'
  return `http://${formatHost(host)}:${record.port}`
}

function formatHost(host: string): string {
  if (host.includes(':') && !host.startsWith('['))
    return `[${host}]`
  return host
}

async function checkCliVersionOnce(
  command: string,
  args: string[],
  cwd: string,
  cache: Map<string, boolean>,
): Promise<void> {
  const key = `${command}::${args.join('|')}`
  if (cache.has(key))
    return
  const result = await checkCliVersion(command, args, cwd || (workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()))
  cache.set(key, result.ok)
  if (!result.ok) {
    const message = result.output.trim()
      ? `Mokup: failed to run "${command} ${args.join(' ')}". ${result.output.trim()}`
      : `Mokup: failed to run "${command} ${args.join(' ')}".`
    window.showWarningMessage(message)
  }
}


async function handleEnsureMockMessage(
  panel: { webview: { postMessage: (data: unknown) => PromiseLike<boolean> } },
  message: unknown,
  entry: DetectedEntry,
  runner: MokupRunner | undefined,
  runnerVersionCache: Map<string, boolean>,
): Promise<boolean> {
  if (!message || typeof message !== 'object')
    return false
  const payload = message as { type?: string }
  if (payload.type !== 'ensureMock')
    return false

  const reply = async (data: { type: 'ensureMockResult', ok: boolean, baseUrl?: string, error?: string }) => {
    await panel.webview.postMessage(data)
  }

  if (!runner) {
    await reply({ type: 'ensureMockResult', ok: false, error: 'Runner unavailable' })
    return true
  }

  const existing = resolveBaseUrl(entry, runner)
  if (existing) {
    await reply({ type: 'ensureMockResult', ok: true, baseUrl: existing })
    return true
  }

  const config = workspace.getConfiguration('mokup')
  const resolved = await resolveRunnerCommand(entry, config)
  await checkCliVersionOnce(resolved.command, resolved.versionArgs, entry.packageRoot, runnerVersionCache)
  runner.start(entry, resolved.command, resolved.args)

  const port = await waitForPort(runner, entry, 12000)
  if (!port) {
    await reply({ type: 'ensureMockResult', ok: false, error: 'Mock startup timed out' })
    return true
  }

  await reply({ type: 'ensureMockResult', ok: true, baseUrl: `http://localhost:${port}` })
  return true
}

function waitForPort(
  runner: MokupRunner,
  entry: DetectedEntry,
  timeoutMs: number,
): Promise<number | undefined> {
  const running = runner.getRunningEntries().find(item => item.entry.packageRoot === entry.packageRoot)
  if (running?.port)
    return Promise.resolve(running.port)

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      dispose?.()
      resolve(undefined)
    }, timeoutMs)
    const dispose = runner.onDidUpdate(() => {
      const record = runner.getRunningEntries().find(item => item.entry.packageRoot === entry.packageRoot)
      if (record?.port) {
        clearTimeout(timeout)
        dispose()
        resolve(record.port)
      }
    })
  })
}
