import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  analyzeChanges,
  collectSecrets,
  createRedactor,
  redactDeep,
  sanitizeTerminalText,
  toAcceptanceSummary,
  truncateText,
} from '../src/lab/supervise/evidence.js'
import type { AcceptanceResult } from '../src/lab/supervise/types.js'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lab-agent-evidence-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('secret collection and redaction', () => {
  test('collects long credentials across environments, longest first', () => {
    expect(
      collectSecrets(
        { DEEPSEEK_API_KEY: 'short', API_KEY: '12345678' },
        { LAB_AUDITOR_API_KEY: 'sk-audit-123456' },
        { ANTHROPIC_API_KEY: '12345678' },
      ),
    ).toEqual(['sk-audit-123456', '12345678'])
  })

  test('redacts exact secrets, sk- tokens, and bearer tokens', () => {
    const redact = createRedactor(['secret-value-1234'])
    expect(redact('value=secret-value-1234')).toBe('value=[REDACTED]')
    expect(redact('key sk-abcdefghijklmnopqrstuvwx')).toBe('key [REDACTED]')
    expect(redact('Authorization: Bearer abcdefghijklmnopqrstuv')).toBe(
      'Authorization: Bearer [REDACTED]',
    )
    expect(redact('nothing here')).toBe('nothing here')
  })

  test('redacts deep values, including cycles', () => {
    const redact = createRedactor(['secret-value-1234'])
    const cycle: Record<string, unknown> = {
      text: 'secret-value-1234',
      nested: { list: ['secret-value-1234', 1] },
    }
    cycle.self = cycle
    const result = redactDeep(cycle, redact) as typeof cycle

    expect(result.text).toBe('[REDACTED]')
    expect(result.nested).toEqual({ list: ['[REDACTED]', 1] })
    expect(result.self).toBe(result)
  })
})

describe('terminal text helpers', () => {
  test('strips ANSI, OSC, C0 controls, and normalizes newlines', () => {
    expect(
      sanitizeTerminalText(
        '\u001b[31mred\u001b[0m\u0007\u001b]0;title\u0007\r\nline',
      ),
    ).toBe('red\nline')
  })

  test('truncates with head, tail, and a marker', () => {
    const input = `${'a'.repeat(900)}${'z'.repeat(100)}`
    const result = truncateText(input, 200)
    expect(result.truncated).toBe(true)
    expect(result.text).toContain('truncated')
    expect(result.text.startsWith('a')).toBe(true)
    expect(result.text.endsWith('z')).toBe(true)
    expect(result.text.length).toBeLessThan(input.length)
  })

  test('leaves short text alone', () => {
    expect(truncateText('short', 100)).toEqual({
      text: 'short',
      truncated: false,
    })
  })
})

describe('toAcceptanceSummary', () => {
  test('records byte sizes and status without output bodies', () => {
    const result: AcceptanceResult = {
      name: 'unit',
      command: 'bun test',
      code: 1,
      signal: null,
      timedOut: false,
      aborted: false,
      durationMs: 12,
      stdout: 'hello',
      stderr: 'oops',
      stdoutTruncated: false,
      stderrTruncated: true,
      ok: false,
    }
    expect(toAcceptanceSummary(result)).toEqual({
      name: 'unit',
      command: 'bun test',
      code: 1,
      signal: null,
      timedOut: false,
      durationMs: 12,
      stdoutBytes: 5,
      stderrBytes: 4,
      stdoutTruncated: false,
      stderrTruncated: true,
      ok: false,
    })
  })
})

describe('analyzeChanges', () => {
  test('accepts allowed paths and deduplicates', () => {
    const analysis = analyzeChanges({
      repoRoot: makeTempDir(),
      changedPaths: ['src/a.ts', 'src/a.ts', './src/b.ts'],
      statusEntries: [],
      allowedPaths: ['src'],
    })
    expect(analysis.changedPaths).toEqual(['src/a.ts', 'src/b.ts'])
    expect(analysis.pathViolations).toEqual([])
  })

  test('flags paths outside the allowlist', () => {
    const analysis = analyzeChanges({
      repoRoot: makeTempDir(),
      changedPaths: ['src/a.ts', 'tests/b.ts', 'src2/c.ts'],
      statusEntries: [],
      allowedPaths: ['src'],
    })
    expect(analysis.pathViolations.map((item) => item.path).sort()).toEqual([
      'src2/c.ts',
      'tests/b.ts',
    ])
    expect(
      analysis.pathViolations.every((item) => item.reason === 'not-allowed'),
    ).toBe(true)
  })

  test('always flags sensitive paths, even inside the allowlist', () => {
    const analysis = analyzeChanges({
      repoRoot: makeTempDir(),
      changedPaths: ['.env', 'src/a.ts'],
      statusEntries: [
        { status: '??', path: '.env.local' },
        { status: ' M', path: 'certs/server.pem' },
      ],
      allowedPaths: ['.'],
    })
    expect(analysis.sensitivePaths).toEqual([
      '.env',
      '.env.local',
      'certs/server.pem',
    ])
    expect(
      analysis.pathViolations.filter((item) => item.reason === 'sensitive'),
    ).toHaveLength(3)
  })

  test('flags unsafe repository paths and too many changes', () => {
    const analysis = analyzeChanges({
      repoRoot: makeTempDir(),
      changedPaths: ['../outside.ts', 'C:/outside.ts', 'src/a.ts', 'src/b.ts'],
      statusEntries: [],
      allowedPaths: ['.'],
      maxChangedPaths: 2,
    })
    expect(
      analysis.pathViolations.some(
        (item) =>
          item.path === '../outside.ts' && item.reason === 'not-allowed',
      ),
    ).toBe(true)
    expect(
      analysis.pathViolations.some(
        (item) => item.reason === 'too-many-paths',
      ),
    ).toBe(true)
  })

  test('flags symlinks that escape the repository', () => {
    const repo = makeTempDir()
    const outside = makeTempDir()
    writeFileSync(join(outside, 'file.txt'), 'outside\n')
    mkdirSync(join(repo, 'src'))
    try {
      symlinkSync(outside, join(repo, 'src', 'link'), 'dir')
    } catch {
      // Windows may require Developer Mode or admin rights for symlinks.
      return
    }

    const analysis = analyzeChanges({
      repoRoot: repo,
      changedPaths: ['src/link/file.txt'],
      statusEntries: [],
      allowedPaths: ['.'],
    })
    expect(analysis.pathViolations).toEqual([
      {
        path: 'src/link/file.txt',
        reason: 'symlink-escape',
        detail: 'symlink 指向仓库外部',
      },
    ])
  })
})
