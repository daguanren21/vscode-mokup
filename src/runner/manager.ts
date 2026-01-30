import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter, type OutputChannel } from 'vscode'
import type { DetectedEntry } from '../scan/collect'

type ProcessRecord = {
  proc: ChildProcess
  entry: DetectedEntry
  port?: number
}

export class MokupRunner {
  private readonly processes = new Map<string, ProcessRecord>()
  private readonly emitter = new EventEmitter<void>()

  readonly onDidUpdate = this.emitter.event

  constructor(private readonly output: OutputChannel) {}

  isRunning(entry: DetectedEntry): boolean {
    return this.processes.has(entry.packageRoot)
  }

  getRunningEntries(): Array<ProcessRecord> {
    return Array.from(this.processes.values())
  }

  start(entry: DetectedEntry, command: string, args: string[]) {
    if (this.isRunning(entry)) {
      this.output.appendLine(`[mokup] already running: ${entry.packageName}`)
      return
    }

    const resolvedArgs = args.map(arg => replacePlaceholders(arg, entry))
    this.output.appendLine(`[mokup] start: ${command} ${resolvedArgs.join(' ')}`)

    const proc = spawn(command, resolvedArgs, {
      cwd: entry.packageRoot,
      shell: true,
      env: process.env,
    })

    proc.stdout?.on('data', data => {
      const text = data.toString()
      this.output.append(text)
      this.detectPort(entry.packageRoot, text)
    })
    proc.stderr?.on('data', data => {
      const text = data.toString()
      this.output.append(text)
      this.detectPort(entry.packageRoot, text)
    })
    proc.on('exit', (code) => {
      this.output.appendLine(`[mokup] exited (${entry.packageName}) code=${code ?? 'null'}`)
      this.processes.delete(entry.packageRoot)
      this.emitter.fire()
    })

    this.processes.set(entry.packageRoot, { proc, entry })
    this.emitter.fire()
  }

  stop(entry: DetectedEntry) {
    const record = this.processes.get(entry.packageRoot)
    if (!record)
      return
    this.output.appendLine(`[mokup] stop: ${entry.packageName}`)
    record.proc.kill()
    this.processes.delete(entry.packageRoot)
    this.emitter.fire()
  }

  stopAll() {
    for (const record of this.processes.values())
      this.stop(record.entry)
  }

  private detectPort(packageRoot: string, text: string) {
    const record = this.processes.get(packageRoot)
    if (!record)
      return
    const port = matchPort(text)
    if (!port || record.port === port)
      return
    record.port = port
    this.emitter.fire()
  }
}

function replacePlaceholders(value: string, entry: DetectedEntry): string {
  return value
    .replace(/\{packageRoot\}/g, entry.packageRoot)
    .replace(/\{entryDir\}/g, entry.dir)
    .replace(/\{prefix\}/g, entry.prefix ?? '')
}

function matchPort(text: string): number | undefined {
  const patterns = [
    /https?:\/\/localhost:(\d+)/i,
    /https?:\/\/127\.0\.0\.1:(\d+)/i,
    /\blocalhost:(\d+)/i,
    /\b127\.0\.0\.1:(\d+)/i,
    /\bport[:\s]+(\d{2,5})/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const port = Number(match[1])
      if (!Number.isNaN(port))
        return port
    }
  }
  return undefined
}
