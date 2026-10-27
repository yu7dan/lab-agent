import { randomUUID } from 'node:crypto'
import { CancelledError, InfraError } from './errors.js'
import type { Redactor } from './evidence.js'
import { runProcessCaptured } from './process.js'
import type {
  EngineResult,
  EngineRunOutput,
  PermissionDenial,
  WriterMode,
} from './types.js'
import { VERDICT_SCHEMA } from './verdict.js'

export const AUDITOR_DISALLOWED_TOOLS = [
  'Write',
  'Edit',
  'NotebookEdit',
  'Bash',
  'PowerShell',
  'Agent',
  'Task',
  'ExitPlanMode',
  'EnterPlanMode',
  'WebFetch',
  'WebSearch',
  'AskUserQuestion',
  'Skill',
]

export interface WriterArgsInput {
  writerMode: WriterMode
  maxTurns: number
  budgetUsd?: number
  sessionId: string
  settingsPath: string
  systemPromptPath: string
}

export function buildWriterArgs(input: WriterArgsInput): string[] {
  return [
    '-p',
    '--output-format',
    'json',
    '--permission-mode',
    input.writerMode === 'bypass' ? 'bypassPermissions' : 'acceptEdits',
    '--max-turns',
    String(input.maxTurns),
    ...(input.budgetUsd !== undefined
      ? ['--max-budget-usd', String(input.budgetUsd)]
      : []),
    '--no-session-persistence',
    '--session-id',
    input.sessionId,
    '--settings',
    input.settingsPath,
    '--append-system-prompt-file',
    input.systemPromptPath,
  ]
}

export interface AuditorArgsInput {
  maxTurns: number
  budgetUsd?: number
  sessionId: string
  settingsPath: string
  systemPromptPath: string
  model?: string
}

export function buildAuditorArgs(input: AuditorArgsInput): string[] {
  return [
    '-p',
    '--output-format',
    'json',
    '--permission-mode',
    'dontAsk',
    '--tools',
    'Read,Grep,Glob',
    '--disallowedTools',
    AUDITOR_DISALLOWED_TOOLS.join(','),
    '--strict-mcp-config',
    '--setting-sources=',
    '--settings',
    input.settingsPath,
    '--json-schema',
    JSON.stringify(VERDICT_SCHEMA),
    '--max-turns',
    String(input.maxTurns),
    ...(input.budgetUsd !== undefined
      ? ['--max-budget-usd', String(input.budgetUsd)]
      : []),
    '--no-session-persistence',
    '--session-id',
    input.sessionId,
    ...(input.model ? ['--model', input.model] : []),
    '--append-system-prompt-file',
    input.systemPromptPath,
  ]
}

export function buildSessionId(): string {
  return randomUUID()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizePermissionDenial(value: unknown): PermissionDenial {
  if (!isRecord(value)) return {}
  return {
    tool_name: typeof value.tool_name === 'string' ? value.tool_name : undefined,
    tool_use_id: typeof value.tool_use_id === 'string' ? value.tool_use_id : undefined,
    tool_input: value.tool_input,
  }
}

function normalizeEngineResult(value: Record<string, unknown>): EngineResult {
  if (typeof value.subtype !== 'string') {
    throw new InfraError('lab-engine result 缺少 subtype')
  }
  return {
    type: 'result',
    subtype: value.subtype,
    is_error: value.is_error === true,
    result: typeof value.result === 'string' ? value.result : '',
    structured_output: value.structured_output,
    permission_denials: Array.isArray(value.permission_denials)
      ? value.permission_denials.map(normalizePermissionDenial)
      : [],
    session_id: typeof value.session_id === 'string' ? value.session_id : undefined,
    num_turns: typeof value.num_turns === 'number' ? value.num_turns : undefined,
    total_cost_usd:
      typeof value.total_cost_usd === 'number' ? value.total_cost_usd : undefined,
    errors: Array.isArray(value.errors)
      ? value.errors.filter((item): item is string => typeof item === 'string')
      : undefined,
  }
}

/**
 * Parse the single result object emitted by `--output-format json` (without
 * `--verbose`). As a fallback, try the last few non-empty lines in case the
 * engine wrote a warning to stdout before the result.
 */
export function parseEngineResult(stdout: string): EngineResult {
  const trimmed = stdout.trim()
  if (!trimmed) {
    throw new InfraError('lab-engine 没有返回任何 stdout')
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const candidates = [trimmed]
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
    candidates.push(lines[i]!)
  }

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate)
      const value = Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed
      if (isRecord(value) && value.type === 'result') {
        return normalizeEngineResult(value)
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new InfraError('lab-engine 没有返回可解析的 result JSON')
}

function tail(text: string, maxChars = 3000): string {
  const value = text.trim()
  return value.length <= maxChars ? value : value.slice(-maxChars)
}

export interface EngineRunInput {
  enginePath: string
  args: string[]
  prompt: string
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  signal?: AbortSignal
  redact?: Redactor
  onStderr?: (chunk: string) => void
  maxStdoutBytes?: number
  maxStderrBytes?: number
}

export async function runEngineCaptured(
  input: EngineRunInput,
): Promise<EngineRunOutput> {
  const redact = input.redact ?? ((text: string) => text)
  const result = await runProcessCaptured(input.enginePath, input.args, {
    cwd: input.cwd,
    env: input.env,
    stdin: input.prompt,
    timeoutMs: input.timeoutMs,
    maxStdoutBytes: input.maxStdoutBytes ?? 16 * 1024 * 1024,
    maxStderrBytes: input.maxStderrBytes ?? 4 * 1024 * 1024,
    signal: input.signal,
    onStderrChunk: input.onStderr
      ? (chunk) => input.onStderr!(redact(chunk))
      : undefined,
  })

  if (result.spawnError) {
    throw new InfraError(`无法启动 lab-engine: ${redact(result.spawnError)}`)
  }
  if (result.aborted) {
    throw new CancelledError()
  }
  if (result.timedOut) {
    throw new InfraError(
      `lab-engine 超时（${Math.round(input.timeoutMs / 1000)}s）` +
        (result.stderr ? `\n${redact(tail(result.stderr))}` : ''),
    )
  }
  if (result.code !== 0) {
    throw new InfraError(
      `lab-engine 退出码 ${result.code}` +
        (result.signal ? ` (${result.signal})` : '') +
        (result.stderr ? `\n${redact(tail(result.stderr))}` : ''),
    )
  }

  const parsed = parseEngineResult(result.stdout)
  if (parsed.subtype !== 'success' || parsed.is_error) {
    const details = [...(parsed.errors ?? []), parsed.result]
      .filter(Boolean)
      .join('\n')
    throw new InfraError(
      `lab-engine 运行失败（${parsed.subtype}）` +
        (details ? `\n${redact(tail(details))}` : ''),
    )
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    parsed,
    durationMs: result.durationMs,
  }
}
