import { describe, expect, test } from 'bun:test'
import { runSupervise } from '../src/lab/supervise/index.js'
import {
  exitCodeForStatus,
  formatHumanReport,
  formatJsonReport,
} from '../src/lab/supervise/report.js'
import type { RoundRecord, SuperviseReport } from '../src/lab/supervise/types.js'

function makeRound(overrides: Partial<RoundRecord> = {}): RoundRecord {
  return {
    round: 1,
    changedPaths: ['src/a.ts', 'tests/a.ts'],
    pathViolations: [
      { path: 'tests/a.ts', reason: 'not-allowed', detail: '不在允许路径内' },
    ],
    acceptance: [
      {
        name: 'tests',
        command: 'bun test',
        code: 1,
        signal: null,
        timedOut: false,
        durationMs: 10,
        stdoutBytes: 10,
        stderrBytes: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
        ok: false,
      },
    ],
    acceptanceChangedWorktree: false,
    headChanged: false,
    gate: {
      ok: false,
      acceptanceOk: false,
      pathsOk: false,
      headOk: true,
      reasons: [
        '验收失败：tests（exit 1）',
        '路径违规：tests/a.ts（不在允许路径内）',
      ],
    },
    verdict: {
      verdict: 'reject',
      summary: 'the change is incomplete',
      findings: [],
    },
    finalVerdict: 'reject',
    findings: [
      {
        severity: 'blocking',
        message: 'add still returns the wrong value',
        evidence: 'expected 3 but got 2',
        file: 'src/a.ts',
        line: 3,
      },
      {
        severity: 'info',
        message: 'this info line should not be printed',
        evidence: 'info evidence',
      },
    ],
    writerPermissionDenials: 2,
    auditorPermissionDenials: 1,
    artifactsDir: 'round-1',
    ...overrides,
  }
}

function makeReport(overrides: Partial<SuperviseReport> = {}): SuperviseReport {
  return {
    schemaVersion: 1,
    status: 'rejected',
    exitCode: 1,
    taskId: '20260101T000000-abcdef',
    repoRoot: 'C:/repo',
    goal: 'fix the \u001b[31madd\u001b[0m function',
    contractHash: 'hash',
    rounds: [makeRound()],
    artifactsDir: 'C:/repo/.lab/tasks/20260101T000000-abcdef',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:01:00.000Z',
    ...overrides,
  }
}

describe('exitCodeForStatus', () => {
  test('maps every status', () => {
    expect(exitCodeForStatus('accepted')).toBe(0)
    expect(exitCodeForStatus('rejected')).toBe(1)
    expect(exitCodeForStatus('needs_human')).toBe(4)
    expect(exitCodeForStatus('infrastructure_error')).toBe(3)
    expect(exitCodeForStatus('cancelled')).toBe(130)
  })
})

describe('formatHumanReport', () => {
  test('summarizes the round, gate, findings, denials, and artifacts', () => {
    const text = formatHumanReport(makeReport())
    expect(text).toContain('Lab Agent supervise — 未通过（rejected）')
    expect(text).toContain('task: 20260101T000000-abcdef')
    expect(text).toContain('goal: fix the add function')
    expect(text).toContain('rounds: 1')
    expect(text).toContain('round 1: reject — the change is incomplete')
    expect(text).toContain('验收: 0/1 通过 · 改动 2 个文件')
    expect(text).toContain('writer 有 2 次工具调用被权限拒绝')
    expect(text).toContain('auditor 有 1 次工具调用被权限拒绝')
    expect(text).toContain('gate: 验收失败：tests（exit 1）')
    expect(text).toContain('src/a.ts:3')
    expect(text).toContain('add still returns the wrong value')
    expect(text).toContain('artifacts: C:/repo/.lab/tasks/20260101T000000-abcdef')
    expect(text).not.toContain('this info line should not be printed')
    expect(text).not.toContain('\u001b')
    expect(text.endsWith('\n')).toBe(true)
  })

  test('handles a report with no completed rounds and an error', () => {
    const text = formatHumanReport(
      makeReport({
        status: 'infrastructure_error',
        exitCode: 3,
        rounds: [],
        error: 'engine exploded',
      }),
    )
    expect(text).toContain('（没有完成任何审查轮次）')
    expect(text).toContain('error: engine exploded')
  })
})

describe('formatJsonReport', () => {
  test('is parseable and ends with a newline', () => {
    const report = makeReport()
    const text = formatJsonReport(report)
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toEqual(report)
  })
})

describe('runSupervise', () => {
  test('--help returns 0 and prints the supervise help', async () => {
    const original = process.stdout.write
    let output = ''
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
      return true
    }) as typeof process.stdout.write
    try {
      expect(await runSupervise(['--help'])).toBe(0)
    } finally {
      process.stdout.write = original
    }
    expect(output).toContain('lab supervise')
    expect(output).toContain('--accept')
    expect(output).toContain('退出码')
  })

  test('usage errors return 2', async () => {
    const original = process.stderr.write
    let output = ''
    process.stderr.write = ((chunk: string | Uint8Array) => {
      output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
      return true
    }) as typeof process.stderr.write
    try {
      expect(await runSupervise(['--not-a-flag'])).toBe(2)
    } finally {
      process.stderr.write = original
    }
    expect(output).toContain('未知参数')
  })
})
