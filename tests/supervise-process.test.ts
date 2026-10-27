import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runProcessCaptured } from '../src/lab/supervise/process.js'

const bun = process.execPath

function baseOptions(overrides: Partial<Parameters<typeof runProcessCaptured>[2]>) {
  return {
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 10_000,
    maxStdoutBytes: 1024 * 1024,
    maxStderrBytes: 1024 * 1024,
    ...overrides,
  }
}

describe('runProcessCaptured', () => {
  test('captures stdout, stderr, stdin, and exit code', async () => {
    const script = `
      let data = ''
      process.stdin.on('data', (chunk) => { data += chunk })
      process.stdin.on('end', () => {
        process.stdout.write('out:' + data.trim())
        process.stderr.write('err')
        process.exit(0)
      })
    `
    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []
    const result = await runProcessCaptured(
      bun,
      ['-e', script],
      baseOptions({
        stdin: 'hello',
        onStdoutChunk: (chunk) => stdoutChunks.push(chunk),
        onStderrChunk: (chunk) => stderrChunks.push(chunk),
      }),
    )

    expect(result.code).toBe(0)
    expect(result.stdout).toBe('out:hello')
    expect(result.stderr).toBe('err')
    expect(result.timedOut).toBe(false)
    expect(result.aborted).toBe(false)
    expect(stdoutChunks.join('')).toBe('out:hello')
    expect(stderrChunks.join('')).toBe('err')
  })

  test('reports non-zero exit codes without throwing', async () => {
    const result = await runProcessCaptured(
      bun,
      ['-e', 'process.stderr.write("bad"); process.exit(7)'],
      baseOptions({}),
    )
    expect(result.code).toBe(7)
    expect(result.stderr).toBe('bad')
    expect(result.spawnError).toBeUndefined()
  })

  test('caps captured stdout and marks it truncated', async () => {
    const result = await runProcessCaptured(
      bun,
      ['-e', 'process.stdout.write("x".repeat(5000))'],
      baseOptions({ maxStdoutBytes: 1000 }),
    )
    expect(result.stdout.length).toBe(1000)
    expect(result.stdoutTruncated).toBe(true)
    expect(result.stderrTruncated).toBe(false)
  })

  test('reports spawn errors', async () => {
    const missing = join(tmpdir(), 'lab-agent-definitely-missing-binary')
    const result = await runProcessCaptured(missing, [], baseOptions({}))
    expect(result.spawnError).toBeDefined()
    expect(result.code).toBeNull()
  })

  test('kills a timed-out process', async () => {
    const result = await runProcessCaptured(
      bun,
      ['-e', 'setInterval(() => {}, 1000)'],
      baseOptions({ timeoutMs: 200 }),
    )
    expect(result.timedOut).toBe(true)
    expect(result.durationMs).toBeLessThan(5000)
  }, 15_000)

  test('kills an aborted process', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 100)
    const result = await runProcessCaptured(
      bun,
      ['-e', 'setInterval(() => {}, 1000)'],
      baseOptions({ signal: controller.signal }),
    )
    expect(result.aborted).toBe(true)
    expect(result.durationMs).toBeLessThan(5000)
  }, 15_000)

  test('does not spawn when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await runProcessCaptured(
      bun,
      ['-e', 'process.stdout.write("should not run")'],
      baseOptions({ signal: controller.signal }),
    )
    expect(result.aborted).toBe(true)
    expect(result.stdout).toBe('')
  })
})
