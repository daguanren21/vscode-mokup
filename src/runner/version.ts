import { spawn } from 'node:child_process'

export type CliVersionResult = {
  ok: boolean
  output: string
}

export async function checkCliVersion(command: string, cwd: string): Promise<CliVersionResult> {
  return await new Promise((resolve) => {
    const proc = spawn(command, ['--version'], {
      cwd,
      shell: true,
      env: process.env,
    })
    let output = ''
    proc.stdout?.on('data', data => { output += data.toString() })
    proc.stderr?.on('data', data => { output += data.toString() })
    proc.on('error', (err) => {
      resolve({ ok: false, output: String(err) })
    })
    proc.on('close', (code) => {
      const ok = code === 0
      resolve({ ok, output })
    })
  })
}
