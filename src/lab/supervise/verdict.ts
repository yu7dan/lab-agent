import { VerdictError } from './errors.js'
import type {
  AcceptanceResult,
  AuditVerdict,
  Confidence,
  Finding,
  FindingSeverity,
  GateResult,
  PathViolation,
  Verdict,
} from './types.js'

export const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'findings'],
  properties: {
    verdict: { enum: ['accept', 'reject', 'needs_human'] },
    summary: { type: 'string', minLength: 1 },
    confidence: { enum: ['high', 'medium', 'low'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'message', 'evidence'],
        properties: {
          severity: { enum: ['blocking', 'non_blocking', 'info'] },
          message: { type: 'string', minLength: 1 },
          file: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          command: { type: 'string' },
          evidence: { type: 'string', minLength: 1 },
        },
      },
    },
  },
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isVerdict(value: unknown): value is Verdict {
  return value === 'accept' || value === 'reject' || value === 'needs_human'
}

function isSeverity(value: unknown): value is FindingSeverity {
  return value === 'blocking' || value === 'non_blocking' || value === 'info'
}

function isConfidence(value: unknown): value is Confidence {
  return value === 'high' || value === 'medium' || value === 'low'
}

function requiredString(
  value: unknown,
  label: string,
  maxChars: number,
): string {
  if (typeof value !== 'string') throw new VerdictError(`${label} 必须是字符串`)
  const text = value.trim()
  if (!text) throw new VerdictError(`${label} 不能为空`)
  if (text.length > maxChars) {
    throw new VerdictError(`${label} 超过 ${maxChars} 个字符`)
  }
  return text
}

function optionalString(
  value: unknown,
  label: string,
  maxChars: number,
): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, label, maxChars)
}

function parseFinding(value: unknown, index: number): Finding {
  if (!isRecord(value)) {
    throw new VerdictError(`findings[${index}] 必须是对象`)
  }
  if (!isSeverity(value.severity)) {
    throw new VerdictError(`findings[${index}].severity 非法`)
  }
  const finding: Finding = {
    severity: value.severity,
    message: requiredString(value.message, `findings[${index}].message`, 2000),
    evidence: requiredString(value.evidence, `findings[${index}].evidence`, 4000),
  }
  const file = optionalString(value.file, `findings[${index}].file`, 1000)
  if (file) finding.file = file
  if (value.line !== undefined) {
    if (
      typeof value.line !== 'number' ||
      !Number.isSafeInteger(value.line) ||
      value.line < 1
    ) {
      throw new VerdictError(`findings[${index}].line 必须是正整数`)
    }
    finding.line = value.line
  }
  const command = optionalString(value.command, `findings[${index}].command`, 4000)
  if (command) finding.command = command
  return finding
}

function hasCitation(finding: Finding): boolean {
  return (
    (!!finding.file && typeof finding.line === 'number' && finding.line >= 1) ||
    !!finding.command
  )
}

/**
 * Validate the auditor's structured output. Never treat a malformed verdict as
 * acceptance. Blocking claims must cite either file+line or a command.
 */
export function parseVerdict(value: unknown): AuditVerdict {
  if (!isRecord(value)) {
    throw new VerdictError('auditor 没有返回结构化 verdict 对象')
  }
  if (!isVerdict(value.verdict)) {
    throw new VerdictError('auditor verdict 必须是 accept / reject / needs_human')
  }
  if (!Array.isArray(value.findings)) {
    throw new VerdictError('auditor findings 必须是数组')
  }
  if (value.findings.length > 50) {
    throw new VerdictError('auditor findings 最多 50 条')
  }

  const findings = value.findings.map(parseFinding)
  for (const [index, finding] of findings.entries()) {
    if (
      finding.severity === 'blocking' &&
      value.verdict !== 'needs_human' &&
      !hasCitation(finding)
    ) {
      throw new VerdictError(
        `findings[${index}] 是 blocking，但没有提供 file+line 或 command 引用`,
      )
    }
  }

  const result: AuditVerdict = {
    verdict: value.verdict,
    summary: requiredString(value.summary, 'auditor summary', 4000),
    findings,
  }
  if (value.confidence !== undefined) {
    if (!isConfidence(value.confidence)) {
      throw new VerdictError('auditor confidence 非法')
    }
    result.confidence = value.confidence
  }
  return result
}

export interface GateInput {
  acceptance: AcceptanceResult[]
  pathViolations: PathViolation[]
  headChanged: boolean
  changedPathCount: number
  maxChangedPaths?: number
}

export const PATH_VIOLATION_TEXT: Record<PathViolation['reason'], string> = {
  'not-allowed': '不在允许路径内',
  sensitive: '敏感文件不允许被修改',
  'symlink-escape': 'symlink 指向仓库外部',
  'too-many-paths': '改动文件数超过上限',
}

export function evaluateGate(input: GateInput): GateResult {
  const maxChangedPaths = input.maxChangedPaths ?? 500
  const acceptanceOk =
    input.acceptance.length > 0 && input.acceptance.every((item) => item.ok)
  const pathsOk =
    input.pathViolations.length === 0 &&
    input.changedPathCount <= maxChangedPaths
  const headOk = !input.headChanged
  const reasons: string[] = []
  const seen = new Set<string>()
  const addReason = (reason: string): void => {
    if (!seen.has(reason)) {
      seen.add(reason)
      reasons.push(reason)
    }
  }

  for (const item of input.acceptance) {
    if (item.ok) continue
    const outcome = item.timedOut
      ? '超时'
      : item.code === null
        ? '无法启动'
        : `exit ${item.code}`
    addReason(`验收失败：${item.name}（${outcome}）`)
  }
  for (const violation of input.pathViolations) {
    const path = violation.path || '(仓库)'
    addReason(`路径违规：${path}（${PATH_VIOLATION_TEXT[violation.reason]}）`)
  }
  if (
    input.changedPathCount > maxChangedPaths &&
    !input.pathViolations.some((violation) => violation.reason === 'too-many-paths')
  ) {
    addReason(
      `改动文件数 ${input.changedPathCount} 超过上限 ${maxChangedPaths}`,
    )
  }
  if (input.headChanged) {
    addReason('writer 改变了 HEAD（禁止 commit/amend）')
  }

  return {
    ok: acceptanceOk && pathsOk && headOk,
    acceptanceOk,
    pathsOk,
    headOk,
    reasons,
  }
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  blocking: 0,
  non_blocking: 1,
  info: 2,
}

function capFindings(findings: Finding[]): Finding[] {
  return [...findings]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, 60)
}

export interface NormalizedDecision {
  finalVerdict: Verdict
  findings: Finding[]
  gate: GateResult
}

/**
 * The wrapper can downgrade an auditor's accept, but never upgrade a reject.
 * Deterministic gate failures always win.
 */
export function normalizeDecision(
  verdict: AuditVerdict,
  gate: GateResult,
): NormalizedDecision {
  const findings = [...verdict.findings]

  if (!gate.ok) {
    for (const reason of gate.reasons) {
      findings.push({
        severity: 'blocking',
        message: reason,
        evidence: 'supervisor deterministic gate',
        command: 'lab supervise',
      })
    }
    return { finalVerdict: 'reject', findings: capFindings(findings), gate }
  }

  if (
    verdict.verdict === 'accept' &&
    findings.some((finding) => finding.severity === 'blocking')
  ) {
    findings.push({
      severity: 'blocking',
      message: 'auditor 返回 accept，但 findings 中包含 blocking 问题',
      evidence: 'auditor verdict consistency check',
      command: 'lab supervise',
    })
    return { finalVerdict: 'reject', findings: capFindings(findings), gate }
  }

  return { finalVerdict: verdict.verdict, findings: capFindings(findings), gate }
}
