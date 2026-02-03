import path from 'node:path'
import net from 'node:net'
import { Uri, workspace, type WorkspaceConfiguration } from 'vscode'
import type { DetectedEntry } from '../scan/collect'

export type ResolvedCommand = {
  command: string
  args: string[]
  versionArgs: string[]
  source: 'config' | 'packageManager'
  packageManager?: string
}

type PackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun'

export async function resolveRunnerCommand(
  entry: DetectedEntry,
  config: WorkspaceConfiguration,
): Promise<ResolvedCommand> {
  const command = config.get<string>('runner.command', 'mokup')
  const args = config.get<string[]>('runner.args', [])
  const mode = config.get<'server' | 'sw'>('runner.mode', 'server')
  const baseArgs = command === 'mokup' && args.length === 0 ? ['serve'] : args
  const shouldAutoPort = command === 'mokup' && args.length === 0

  if (command !== 'mokup' || args.length > 0) {
    const mokupArgs = applyRunnerMode(baseArgs, mode)
    return {
      command,
      args: mokupArgs,
      versionArgs: ['--help'],
      source: 'config',
    }
  }

  const pm = await detectPackageManager(entry)
  if (!pm) {
    const mokupArgs = applyRunnerMode(baseArgs, mode)
    return {
      command,
      args: mokupArgs,
      versionArgs: ['--help'],
      source: 'config',
    }
  }

  const mokupArgs = applyRunnerMode(baseArgs, mode)
  const finalArgs = shouldAutoPort ? await applyAutoPort(mokupArgs) : mokupArgs
  const run = buildPackageManagerArgs(pm, mokupArgs)
  const version = buildPackageManagerArgs(pm, ['--help'])
  return {
    command: run.command,
    args: shouldAutoPort ? buildPackageManagerArgs(pm, finalArgs).args : run.args,
    versionArgs: version.args,
    source: 'packageManager',
    packageManager: pm,
  }
}

export async function resolveBuildCommand(
  entry: DetectedEntry,
  config: WorkspaceConfiguration,
): Promise<ResolvedCommand> {
  const command = config.get<string>('build.command', config.get('runner.command', 'mokup'))
  let args = config.get<string[]>('build.args', ['build'])
  const mode = config.get<'server' | 'sw'>('runner.mode', 'server')

  const isDefault = command === 'mokup' && (args.length === 0 || (args.length === 1 && args[0] === 'build'))
  if (!isDefault) {
    args = applyRunnerMode(args, mode)
    return {
      command,
      args,
      versionArgs: ['--help'],
      source: 'config',
    }
  }

  const pm = await detectPackageManager(entry)
  if (!pm) {
    args = applyRunnerMode(args, mode)
    return {
      command,
      args,
      versionArgs: ['--help'],
      source: 'config',
    }
  }

  const mokupArgs = applyRunnerMode(['build'], mode)
  const run = buildPackageManagerArgs(pm, mokupArgs)
  const version = buildPackageManagerArgs(pm, ['--help'])
  return {
    command: run.command,
    args: run.args,
    versionArgs: version.args,
    source: 'packageManager',
    packageManager: pm,
  }
}

export function applyRunnerMode(args: string[], mode: 'server' | 'sw'): string[] {
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

async function detectPackageManager(entry: DetectedEntry): Promise<PackageManager | undefined> {
  const roots = new Set<string>()
  roots.add(entry.packageRoot)
  const workspaceRoot = workspace.workspaceFolders?.[0]?.uri.fsPath
  if (workspaceRoot)
    roots.add(workspaceRoot)

  const candidates: Array<[PackageManager, string]> = [
    ['pnpm', 'pnpm-lock.yaml'],
    ['yarn', 'yarn.lock'],
    ['npm', 'package-lock.json'],
    ['bun', 'bun.lockb'],
  ]

  for (const root of roots) {
    for (const [pm, file] of candidates) {
      const target = path.join(root, file)
      if (await fileExists(target))
        return pm
    }
  }

  return undefined
}

function buildPackageManagerArgs(
  pm: PackageManager,
  mokupArgs: string[],
): { command: string, args: string[] } {
  if (pm === 'pnpm')
    return { command: 'pnpm', args: ['exec', 'mokup', ...mokupArgs] }
  if (pm === 'yarn')
    return { command: 'yarn', args: ['run', 'mokup', ...mokupArgs] }
  if (pm === 'npm') {
    const separator = mokupArgs.length > 0 ? ['--'] : []
    return { command: 'npm', args: ['exec', 'mokup', ...separator, ...mokupArgs] }
  }
  return { command: 'bun', args: ['x', 'mokup', ...mokupArgs] }
}

async function applyAutoPort(args: string[]): Promise<string[]> {
  if (hasPortArg(args))
    return args
  const selected = await findAvailablePort(8080, 10)
  if (!selected || selected === 8080)
    return args
  return [...args, '--port', String(selected)]
}

function hasPortArg(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--port' || arg === '-p')
      return true
    if (arg.startsWith('--port='))
      return true
    if (arg === '-p' && typeof args[i + 1] === 'string')
      return true
  }
  return false
}

async function findAvailablePort(base: number, attempts: number): Promise<number | undefined> {
  for (let i = 0; i < attempts; i++) {
    const port = base + i
    const ok = await isPortAvailable(port)
    if (ok)
      return port
  }
  return undefined
}

async function isPortAvailable(port: number): Promise<boolean> {
  const hosts = ['127.0.0.1', '::1']
  for (const host of hosts) {
    const ok = await canListen(port, host)
    if (!ok)
      return false
  }
  return true
}

function canListen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE')
        resolve(false)
      else
        resolve(true)
    })
    server.listen(port, host, () => {
      server.close(() => resolve(true))
    })
  })
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await workspace.fs.stat(Uri.file(target))
    return true
  }
  catch {
    return false
  }
}
