import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  buildAcceptanceEnv,
  runAcceptance,
} from '../src/lab/supervise/acceptance.js'
import { CancelledError } from '../src/lab/supervise/errors.js'
import type { AcceptanceCommand } from '../src/lab/supervise/types.js'

const bun = process.execPath
const isWindows = process.platform === 'win32'
const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lab-agent-acceptance-'))
  tempDirs.push(dir)
  return dir
}

function quote(value: string): string {
  if (isWindows) return `"${value.replace(/"/g, '""')}"`
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function scriptCommand(source: string): string {
  const file = join(makeTempDir(), 'script.mjs')
  writeFileSync(file, source)
  return `${quote(bun)} ${quote(file)}`
}

function exitCommand(code: number): string {
  return isWindows ? `exit /b ${code}` : `exit ${code}`
}

const sleepCommand = isWindows
  ? 'ping -n 20 127.0.0.1 >nul'
  : 'sleep 20'

function commands(...items: Array<[string, string]>): AcceptanceCommand[] {
  return items.map(([name, command]) => ({ name, command, timeoutSec: 10 }))
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('buildAcceptanceEnv', () => {
  test('removes provider credentials and LAB_AUDITOR_*', () => {
    const env = buildAcceptanceEnv({
      PATH: '/bin',
      HOME: '/home',
      ANTHROPIC_API_KEY: 'a',
      ANTHROPIC_AUTH_TOKEN: 'b',
      DEEPSEEK_API_KEY: 'c',
      API_KEY: 'd',
      LAB_AUDITOR_API_KEY: 'e',
      LAB_AUDITOR_MODEL: 'f',
      ANTHROPIC_BASE_URL: 'keep-me',
    })
    expect(env.PATH).toBe('/bin')
    expect(env.HOME).toBe('/home')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()
    expect(env.API_KEY).toBeUndefined()
    expect(env.LAB_AUDITOR_API_KEY).toBeUndefined()
    expect(env.LAB_AUDITOR_MODEL).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBe('keep-me')
  })
})

describe('runAcceptance', () => {
  test('runs commands sequentially and continues after a failure', async () => {
    const results = await runAcceptance(
      [
        ...commands(['one', 'echo one']),
        { name: 'fail', command: exitCommand(7), timeoutSec: 10 },
        { name: 'three', command: 'echo three', timeoutSec: 10 },
      ],
      { cwd: process.cwd(), env: process.env },
    )

    expect(results.map((result) => result.name)).toEqual(['one', 'fail', 'three'])
    expect(results[0]!.ok).toBe(true)
    expect(results[0]!.stdout.trim()).toBe('one')
    expect(results[1]!.ok).toBe(false)
    expect(results[1]!.code).toBe(7)
    expect(results[2]!.ok).toBe(true)
    expect(results[2]!.stdout.trim()).toBe('three')
  })

  test('runs in the requested cwd with a cleaned environment', async () => {
    const dir = makeTempDir()
    const command = scriptCommand(`
      const names = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
        'DEEPSEEK_API_KEY', 'API_KEY']
      console.log(JSON.stringify({
        cwd: process.cwd(),
        present: names.filter((name) => process.env[name] !== undefined),
        auditor: Object.keys(process.env).filter((key) => key.startsWith('LAB_AUDITOR_')),
      }))
    `)

    const results = await runAcceptance(
      [{ name: 'env', command, timeoutSec: 10 }],
      {
        cwd: dir,
        env: {
          PATH: process.env.PATH,
          ANTHROPIC_API_KEY: 'sk-a',
          ANTHROPIC_AUTH_TOKEN: 'token-b',
          DEEPSEEK_API_KEY: 'sk-c',
          API_KEY: 'key-d',
          LAB_AUDITOR_API_KEY: 'audit',
        },
      },
    )

    expect(results[0]!.ok).toBe(true)
    const parsed = JSON.parse(results[0]!.stdout.trim()) as {
      cwd: string
      present: string[]
      auditor: string[]
    }
    expect(resolve(parsed.cwd).toLowerCase()).toBe(resolve(dir).toLowerCase())
    expect(parsed.present).toEqual([])
    expect(parsed.auditor).toEqual([])
  })

  test('forwards output chunks through onOutput', async () => {
    const chunks: string[] = []
    await runAcceptance([{ name: 'out', command: 'echo chunk', timeoutSec: 10 }], {
      cwd: process.cwd(),
      onOutput: (_name, stream, chunk) => {
        if (stream === 'stdout') chunks.push(chunk)
      },
    })
    expect(chunks.join('').trim()).toBe('chunk')
  })

  test('marks timed-out commands and kills them', async () => {
    const results = await runAcceptance(
      [{ name: 'slow', command: sleepCommand, timeoutSec: 1 }],
      { cwd: process.cwd(), env: process.env },
    )
    expect(results[0]!.timedOut).toBe(true)
    expect(results[0]!.ok).toBe(false)
    expect(results[0]!.durationMs).toBeLessThan(15_000)
  }, 20_000)

  test('caps captured output at 1 MiB', async () => {
    const command = scriptCommand(
      "process.stdout.write('x'.repeat(1200 * 1024))",
    )
    const results = await runAcceptance(
      [{ name: 'big', command, timeoutSec: 20 }],
      { cwd: process.cwd(), env: process.env },
    )
    expect(results[0]!.stdout.length).toBe(1024 * 1024)
    expect(results[0]!.stdoutTruncated).toBe(true)
  }, 20_000)

  test('throws CancelledError when aborted', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 100)
    await expect(
      runAcceptance([{ name: 'slow', command: sleepCommand, timeoutSec: 20 }], {
        cwd: process.cwd(),
        env: process.env,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(CancelledError)
  }, 20_000)

  test('returns an empty array when there are no commands', async () => {
    expect(await runAcceptance([], { cwd: process.cwd() })).toEqual([])
  })
})
