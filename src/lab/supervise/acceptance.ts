import { CancelledError } from './errors.js'
import { runProcessCaptured } from './process.js'
import type { AcceptanceCommand, AcceptanceResult } from './types.js'

export interface AcceptanceRunOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  onOutput?: (
    name: string,
    stream: 'stdout' | 'stderr',
    chunk: string,
  ) => void
}

/** Do not hand provider credentials to tests or build scripts. */
export function buildAcceptanceEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  delete env.DEEPSEEK_API_KEY
  delete env.API_KEY
  for (const key of Object.keys(env)) {
    if (key.startsWith('LAB_AUDITOR_')) delete env[key]
  }
  return env
}

/**
 * Run the contract's acceptance commands in order, continuing after failures so
 * the writer and auditor get complete evidence. Output is capped per stream.
 * The command is user-supplied and trusted input; do not supervise untrusted
 * repositories.
 */
export async function runAcceptance(
  commands: AcceptanceCommand[],
  options: AcceptanceRunOptions,
): Promise<AcceptanceResult[]> {
  const env = buildAcceptanceEnv(options.env ?? process.env)
  const results: AcceptanceResult[] = []

  for (const command of commands) {
    if (options.signal?.aborted) throw new CancelledError()

    const useShell = process.platform === 'win32'
    const executable = useShell ? command.command : '/bin/sh'
    const args = useShell ? [] : ['-c', command.command]

    const result = await runProcessCaptured(executable, args, {
      cwd: options.cwd,
      env,
      timeoutMs: command.timeoutSec * 1000,
      maxStdoutBytes: 1024 * 1024,
      maxStderrBytes: 1024 * 1024,
      shell: useShell,
      signal: options.signal,
      onStdoutChunk: options.onOutput
        ? (chunk) => options.onOutput!(command.name, 'stdout', chunk)
        : undefined,
      onStderrChunk: options.onOutput
        ? (chunk) => options.onOutput!(command.name, 'stderr', chunk)
        : undefined,
    })

    if (result.aborted) throw new CancelledError()

    const stderr = result.spawnError
      ? `${result.spawnError}\n${result.stderr}`.trim()
      : result.stderr
    results.push({
      name: command.name,
      command: command.command,
      code: result.code,
      signal: result.signal,
      timedOut: result.timedOut,
      aborted: false,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      ok: !result.spawnError && !result.timedOut && result.code === 0,
    })
  }

  return results
}
