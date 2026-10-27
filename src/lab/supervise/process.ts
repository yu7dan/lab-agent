import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

export interface ProcessOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  stdin?: string
  timeoutMs: number
  maxStdoutBytes: number
  maxStderrBytes: number
  shell?: boolean
  signal?: AbortSignal
  onStdoutChunk?: (chunk: string) => void
  onStderrChunk?: (chunk: string) => void
  windowsHide?: boolean
}

export interface ProcessResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
  aborted: boolean
  stdoutTruncated: boolean
  stderrTruncated: boolean
  spawnError?: string
}

/** Kill a child and its descendants. Windows uses taskkill /T. */
export function killProcessTree(
  pid: number | undefined,
  signal: NodeJS.Signals = 'SIGTERM',
): void {
  if (!pid) return
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.on('error', () => {})
      killer.unref()
    } catch {
      // The child may already be gone.
    }
    return
  }

  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // Already gone.
    }
  }

  if (signal !== 'SIGKILL') {
    const timer = setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }, 2000)
    timer.unref()
  }
}

function emptyResult(aborted: boolean, spawnError?: string): ProcessResult {
  return {
    code: null,
    signal: null,
    stdout: '',
    stderr: '',
    durationMs: 0,
    timedOut: false,
    aborted,
    stdoutTruncated: false,
    stderrTruncated: false,
    spawnError,
  }
}

/**
 * Run a process with captured stdio, a hard timeout, stdout/stderr caps, and
 * process-tree termination. On POSIX the child is a process-group leader so a
 * timeout or abort also stops its grandchildren. The promise always resolves;
 * callers map spawnError/timedOut/aborted to their own failure semantics.
 */
export function runProcessCaptured(
  command: string,
  args: string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  if (options.signal?.aborted) {
    return Promise.resolve(emptyResult(true))
  }

  const startedAt = Date.now()
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: options.shell ?? false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: options.windowsHide ?? true,
      detached: process.platform !== 'win32',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return Promise.resolve(emptyResult(false, message))
  }

  return new Promise<ProcessResult>((resolvePromise) => {
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')
    let stdoutBytes = 0
    let stderrBytes = 0
    let stdoutTruncated = false
    let stderrTruncated = false
    let timedOut = false
    let aborted = false
    let spawnError: string | undefined
    let settled = false
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined

    const cleanup = (): void => {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (fallbackTimer) clearTimeout(fallbackTimer)
      options.signal?.removeEventListener('abort', onAbort)
    }

    const finish = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      if (settled) return
      settled = true
      cleanup()
      resolvePromise({
        code,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        durationMs: Date.now() - startedAt,
        timedOut,
        aborted,
        stdoutTruncated,
        stderrTruncated,
        spawnError,
      })
    }

    const terminate = (): void => {
      if (settled) return
      killProcessTree(child.pid)
      // A wedged child must not hang the supervisor forever.
      fallbackTimer = setTimeout(() => finish(null, 'SIGKILL'), 5000)
    }

    const onAbort = (): void => {
      if (settled) return
      aborted = true
      terminate()
    }

    timeoutTimer = setTimeout(() => {
      if (settled) return
      timedOut = true
      terminate()
    }, options.timeoutMs)

    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.on('error', (error) => {
      spawnError = error.message
      finish(null, null)
    })

    child.on('close', (code, signal) => {
      finish(code, signal)
    })

    child.stdout?.on('data', (chunk: Buffer) => {
      const remaining = options.maxStdoutBytes - stdoutBytes
      if (remaining > 0) {
        const slice = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining)
        stdoutChunks.push(slice)
        stdoutBytes += slice.length
      }
      if (chunk.length > Math.max(remaining, 0)) stdoutTruncated = true
      const text = stdoutDecoder.write(chunk)
      if (text && options.onStdoutChunk) options.onStdoutChunk(text)
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const remaining = options.maxStderrBytes - stderrBytes
      if (remaining > 0) {
        const slice = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining)
        stderrChunks.push(slice)
        stderrBytes += slice.length
      }
      if (chunk.length > Math.max(remaining, 0)) stderrTruncated = true
      const text = stderrDecoder.write(chunk)
      if (text && options.onStderrChunk) options.onStderrChunk(text)
    })

    child.stdin?.on('error', () => {
      // EPIPE is expected when the child exits before reading stdin.
    })
    child.stdin?.end(options.stdin ?? '')
  })
}
