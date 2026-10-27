import { describe, expect, test } from 'bun:test'
import { VerdictError } from '../src/lab/supervise/errors.js'
import type {
  AcceptanceResult,
  AuditVerdict,
  Finding,
  GateResult,
} from '../src/lab/supervise/types.js'
import {
  evaluateGate,
  normalizeDecision,
  parseVerdict,
  VERDICT_SCHEMA,
} from '../src/lab/supervise/verdict.js'

function acceptance(ok: boolean, overrides: Partial<AcceptanceResult> = {}): AcceptanceResult {
  return {
    name: 'unit',
    command: 'bun test',
    code: ok ? 0 : 1,
    signal: null,
    timedOut: false,
    aborted: false,
    durationMs: 10,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    ok,
    ...overrides,
  }
}

function verdict(overrides: Partial<AuditVerdict> = {}): AuditVerdict {
  return {
    verdict: 'accept',
    summary: 'looks good',
    findings: [],
    ...overrides,
  }
}

function gate(overrides: Partial<GateResult> = {}): GateResult {
  return {
    ok: true,
    acceptanceOk: true,
    pathsOk: true,
    headOk: true,
    reasons: [],
    ...overrides,
  }
}

describe('VERDICT_SCHEMA', () => {
  test('is strict and requires the core fields', () => {
    expect(VERDICT_SCHEMA.additionalProperties).toBe(false)
    expect(VERDICT_SCHEMA.required).toEqual(['verdict', 'summary', 'findings'])
    expect(VERDICT_SCHEMA.properties.findings.items.required).toEqual([
      'severity',
      'message',
      'evidence',
    ])
  })
})

describe('parseVerdict', () => {
  test('accepts a valid structured verdict', () => {
    const parsed = parseVerdict({
      verdict: 'accept',
      summary: '  looks good  ',
      confidence: 'high',
      findings: [
        {
          severity: 'blocking',
          message: 'a real issue',
          evidence: 'src/a.ts:3 shows it',
          file: 'src/a.ts',
          line: 3,
        },
      ],
    })
    expect(parsed.verdict).toBe('accept')
    expect(parsed.summary).toBe('looks good')
    expect(parsed.confidence).toBe('high')
    expect(parsed.findings).toEqual([
      {
        severity: 'blocking',
        message: 'a real issue',
        evidence: 'src/a.ts:3 shows it',
        file: 'src/a.ts',
        line: 3,
      },
    ])
  })

  test('allows uncited blocking findings only for needs_human', () => {
    expect(() =>
      parseVerdict({
        verdict: 'reject',
        summary: 'bad',
        findings: [
          { severity: 'blocking', message: 'bad', evidence: 'trust me' },
        ],
      }),
    ).toThrow(VerdictError)

    expect(() =>
      parseVerdict({
        verdict: 'needs_human',
        summary: 'unclear',
        findings: [
          { severity: 'blocking', message: 'unclear', evidence: 'ambiguous' },
        ],
      }),
    ).not.toThrow()
  })

  test('accepts a command citation for a blocking finding', () => {
    const parsed = parseVerdict({
      verdict: 'reject',
      summary: 'test failed',
      findings: [
        {
          severity: 'blocking',
          message: 'test failed',
          evidence: 'exit 1',
          command: 'bun test',
        },
      ],
    })
    expect(parsed.findings[0]!.command).toBe('bun test')
  })

  test('rejects malformed verdicts', () => {
    for (const value of [
      undefined,
      null,
      [],
      { verdict: 'maybe', summary: 'x', findings: [] },
      { verdict: 'accept', summary: '', findings: [] },
      { verdict: 'accept', summary: 'x', findings: 'nope' },
      { verdict: 'accept', summary: 'x', findings: [], confidence: 'certain' },
      {
        verdict: 'accept',
        summary: 'x',
        findings: [{ severity: 'blocking', message: 'm', evidence: 'e', line: 0 }],
      },
      {
        verdict: 'accept',
        summary: 'x',
        findings: [{ severity: 'nope', message: 'm', evidence: 'e' }],
      },
    ]) {
      expect(() => parseVerdict(value)).toThrow(VerdictError)
    }
  })

  test('caps findings at 50', () => {
    const findings = Array.from({ length: 51 }, (_, index) => ({
      severity: 'info' as const,
      message: `m${index}`,
      evidence: 'e',
    }))
    expect(() =>
      parseVerdict({ verdict: 'accept', summary: 'x', findings }),
    ).toThrow(VerdictError)
  })
})

describe('evaluateGate', () => {
  test('passes when acceptance, paths, and HEAD are clean', () => {
    expect(
      evaluateGate({
        acceptance: [acceptance(true)],
        pathViolations: [],
        headChanged: false,
        changedPathCount: 3,
      }),
    ).toEqual({
      ok: true,
      acceptanceOk: true,
      pathsOk: true,
      headOk: true,
      reasons: [],
    })
  })

  test('fails on acceptance failure and timeout with reasons', () => {
    const result = evaluateGate({
      acceptance: [
        acceptance(false, { name: 'unit', code: 1 }),
        acceptance(false, { name: 'slow', code: null, timedOut: true }),
      ],
      pathViolations: [],
      headChanged: false,
      changedPathCount: 0,
    })
    expect(result.ok).toBe(false)
    expect(result.acceptanceOk).toBe(false)
    expect(result.pathsOk).toBe(true)
    expect(result.reasons).toContain('验收失败：unit（exit 1）')
    expect(result.reasons).toContain('验收失败：slow（超时）')
  })

  test('fails on path violations and too many paths', () => {
    const result = evaluateGate({
      acceptance: [acceptance(true)],
      pathViolations: [
        { path: 'tests/a.ts', reason: 'not-allowed', detail: '不在允许路径内' },
      ],
      headChanged: false,
      changedPathCount: 3,
      maxChangedPaths: 2,
    })
    expect(result.ok).toBe(false)
    expect(result.pathsOk).toBe(false)
    expect(result.reasons).toContain('路径违规：tests/a.ts（不在允许路径内）')
    expect(result.reasons).toContain('改动文件数 3 超过上限 2')
  })

  test('fails when HEAD changed', () => {
    const result = evaluateGate({
      acceptance: [acceptance(true)],
      pathViolations: [],
      headChanged: true,
      changedPathCount: 0,
    })
    expect(result.ok).toBe(false)
    expect(result.headOk).toBe(false)
    expect(result.reasons).toEqual(['writer 改变了 HEAD（禁止 commit/amend）'])
  })
})

describe('normalizeDecision', () => {
  test('the gate downgrades an auditor accept', () => {
    const failed = gate({
      ok: false,
      acceptanceOk: false,
      reasons: ['验收失败：unit（exit 1）'],
    })
    const decision = normalizeDecision(verdict(), failed)
    expect(decision.finalVerdict).toBe('reject')
    expect(
      decision.findings.some(
        (finding) =>
          finding.severity === 'blocking' &&
          finding.message.includes('验收失败'),
      ),
    ).toBe(true)
  })

  test('accept with a blocking finding is downgraded', () => {
    const finding: Finding = {
      severity: 'blocking',
      message: 'contradiction',
      evidence: 'evidence',
      file: 'src/a.ts',
      line: 1,
    }
    const decision = normalizeDecision(
      verdict({ findings: [finding] }),
      gate(),
    )
    expect(decision.finalVerdict).toBe('reject')
    expect(
      decision.findings.some((item) =>
        item.message.includes('一致性检查') || item.message.includes('包含 blocking'),
      ),
    ).toBe(true)
  })

  test('passes gate-clean reject and needs_human through', () => {
    expect(
      normalizeDecision(verdict({ verdict: 'reject' }), gate()).finalVerdict,
    ).toBe('reject')
    expect(
      normalizeDecision(verdict({ verdict: 'needs_human' }), gate()).finalVerdict,
    ).toBe('needs_human')
  })

  test('caps findings at 60 with blocking first', () => {
    const findings: Finding[] = Array.from({ length: 70 }, (_, index) => ({
      severity: index === 69 ? 'blocking' : 'info',
      message: `finding ${index}`,
      evidence: 'e',
      ...(index === 69 ? { command: 'bun test' } : {}),
    }))
    const decision = normalizeDecision(
      verdict({ verdict: 'reject', findings }),
      gate(),
    )
    expect(decision.findings).toHaveLength(60)
    expect(decision.findings[0]!.severity).toBe('blocking')
  })
})
