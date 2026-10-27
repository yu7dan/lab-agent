export type WriterMode = 'bypass' | 'acceptEdits'
export type Verdict = 'accept' | 'reject' | 'needs_human'
export type FindingSeverity = 'blocking' | 'non_blocking' | 'info'
export type Confidence = 'high' | 'medium' | 'low'

export interface AcceptanceCommand {
  name: string
  command: string
  timeoutSec: number
}

export interface FileAcceptanceCommand {
  name?: string
  command: string
  timeoutSec?: number
}

export interface FileContract {
  version?: number
  goal?: string
  constraints?: string[]
  allowedPaths?: string[]
  acceptance?: Array<string | FileAcceptanceCommand>
  maxRounds?: number
  writerMode?: WriterMode
  writerTimeoutSec?: number
  acceptTimeoutSec?: number
  writerMaxTurns?: number
  writerBudgetUsd?: number
}

export interface ParsedSuperviseArgs {
  goal?: string
  contractFile?: string
  accept: string[]
  allow: string[]
  constraints: string[]
  maxRounds?: number
  writerMode?: WriterMode
  writerTimeoutSec?: number
  acceptTimeoutSec?: number
  writerMaxTurns?: number
  writerBudgetUsd?: number
  json: boolean
  verbose: boolean
  help: boolean
}

export interface ResolvedContract {
  goal: string
  constraints: string[]
  allowedPaths: string[]
  acceptance: AcceptanceCommand[]
  maxRounds: number
  writerMode: WriterMode
  writerTimeoutSec: number
  acceptTimeoutSec: number
  writerMaxTurns: number
  writerBudgetUsd?: number
  contractHash: string
}

export interface Finding {
  severity: FindingSeverity
  message: string
  evidence: string
  file?: string
  line?: number
  command?: string
}

export interface AuditVerdict {
  verdict: Verdict
  summary: string
  confidence?: Confidence
  findings: Finding[]
}

export type PathViolationReason =
  | 'not-allowed'
  | 'sensitive'
  | 'symlink-escape'
  | 'too-many-paths'

export interface PathViolation {
  path: string
  reason: PathViolationReason
  detail?: string
}

export interface GateResult {
  ok: boolean
  acceptanceOk: boolean
  pathsOk: boolean
  headOk: boolean
  reasons: string[]
}

export interface PermissionDenial {
  tool_name?: string
  tool_use_id?: string
  tool_input?: unknown
}

export interface EngineResult {
  type: 'result'
  subtype: string
  is_error: boolean
  result: string
  structured_output?: unknown
  permission_denials: PermissionDenial[]
  session_id?: string
  num_turns?: number
  total_cost_usd?: number
  errors?: string[]
}

export interface EngineRunOutput {
  stdout: string
  stderr: string
  parsed: EngineResult
  durationMs: number
}

export interface AcceptanceResult {
  name: string
  command: string
  code: number | null
  signal: string | null
  timedOut: boolean
  aborted: boolean
  durationMs: number
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  ok: boolean
}

export interface AcceptanceSummary {
  name: string
  command: string
  code: number | null
  signal: string | null
  timedOut: boolean
  durationMs: number
  stdoutBytes: number
  stderrBytes: number
  stdoutTruncated: boolean
  stderrTruncated: boolean
  ok: boolean
}

export interface RoundRecord {
  round: number
  changedPaths: string[]
  pathViolations: PathViolation[]
  acceptance: AcceptanceSummary[]
  acceptanceChangedWorktree: boolean
  headChanged: boolean
  gate: GateResult
  verdict: AuditVerdict
  finalVerdict: Verdict
  findings: Finding[]
  writerSessionId?: string
  auditorSessionId?: string
  writerCostUsd?: number
  auditorCostUsd?: number
  writerTurns?: number
  auditorTurns?: number
  writerPermissionDenials?: number
  auditorPermissionDenials?: number
  artifactsDir: string
}

export type ReportStatus =
  | 'accepted'
  | 'rejected'
  | 'needs_human'
  | 'infrastructure_error'
  | 'cancelled'

export interface SuperviseReport {
  schemaVersion: 1
  status: ReportStatus
  exitCode: number
  taskId: string
  repoRoot: string
  goal: string
  contractHash: string
  rounds: RoundRecord[]
  artifactsDir: string
  startedAt: string
  finishedAt: string
  error?: string
}

export type SupervisorEvent =
  | { type: 'round-start'; round: number }
  | { type: 'writer-start'; round: number }
  | { type: 'writer-done'; round: number; sessionId?: string }
  | { type: 'acceptance-start'; round: number }
  | { type: 'acceptance-done'; round: number; ok: boolean }
  | { type: 'auditor-start'; round: number }
  | { type: 'auditor-done'; round: number; verdict: Verdict }
  | { type: 'round-done'; round: number; finalVerdict: Verdict }
  | { type: 'done'; status: ReportStatus }

export interface PreviousReview {
  round: number
  finalVerdict: Verdict
  summary: string
  findings: Finding[]
  gateReasons: string[]
}

export interface AuditorConfig {
  model?: string
  baseUrl: string
  apiKey: string
  maxTurns: number
  timeoutSec: number
  budgetUsd?: number
}

export interface SuperviseRunOptions {
  cwd: string
}
