import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { UsageError } from './errors.js'
import type {
  AcceptanceCommand,
  FileAcceptanceCommand,
  FileContract,
  ParsedSuperviseArgs,
  ResolvedContract,
  WriterMode,
} from './types.js'

export const MAX_ACCEPTANCE_COMMANDS = 10
export const MAX_ALLOWED_PATHS = 50
export const MAX_CONSTRAINTS = 50
export const MAX_COMMAND_CHARS = 4000
export const MAX_GOAL_CHARS = 20_000
export const MAX_CONSTRAINT_CHARS = 2000
export const MAX_CONTRACT_BYTES = 1024 * 1024

const DEFAULT_MAX_ROUNDS = 2
const DEFAULT_WRITER_TIMEOUT_SEC = 1800
const DEFAULT_ACCEPT_TIMEOUT_SEC = 600
const DEFAULT_WRITER_MAX_TURNS = 60

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function integerInRange(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new UsageError(`${label} 必须是整数`)
  }
  if (value < min || value > max) {
    throw new UsageError(`${label} 必须在 ${min}..${max} 之间`)
  }
  return value
}

function positiveAmount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new UsageError(`${label} 必须是正数`)
  }
  return value
}

function parseWriterMode(value: unknown, label: string): WriterMode {
  if (value === 'bypass' || value === 'acceptEdits') return value
  throw new UsageError(`${label} 必须是 bypass 或 acceptEdits`)
}

function trimmedText(value: unknown, label: string, maxChars: number): string {
  if (typeof value !== 'string') throw new UsageError(`${label} 必须是字符串`)
  const text = value.trim()
  if (!text) throw new UsageError(`${label} 不能为空`)
  if (text.length > maxChars) {
    throw new UsageError(`${label} 不能超过 ${maxChars} 个字符`)
  }
  return text
}

function parseIntegerFlag(
  raw: string,
  label: string,
  min: number,
  max: number,
): number {
  if (!/^\d+$/.test(raw.trim())) {
    throw new UsageError(`${label} 必须是整数`)
  }
  return integerInRange(Number(raw), label, min, max)
}

function parseBudgetFlag(raw: string, label: string): number {
  const value = Number(raw)
  return positiveAmount(value, label)
}

function takeFlagValue(
  argv: string[],
  index: number,
  flag: string,
  inline: string | undefined,
): { value: string; nextIndex: number } {
  if (inline !== undefined) return { value: inline, nextIndex: index }
  const next = argv[index + 1]
  if (next === undefined) throw new UsageError(`缺少 ${flag} 的值`)
  return { value: next, nextIndex: index + 1 }
}

/**
 * Parse `lab supervise` arguments without a CLI framework. Supports
 * `--flag value` and `--flag=value`; repeatable flags are collected in order.
 */
export function parseSuperviseArgs(argv: string[]): ParsedSuperviseArgs {
  const help = argv.includes('--help') || argv.includes('-h')
  if (help) {
    return {
      accept: [],
      allow: [],
      constraints: [],
      json: false,
      verbose: false,
      help: true,
    }
  }

  const parsed: ParsedSuperviseArgs = {
    accept: [],
    allow: [],
    constraints: [],
    json: false,
    verbose: false,
    help: false,
  }
  const goalParts: string[] = []
  let positionalOnly = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!positionalOnly && arg === '--') {
      positionalOnly = true
      continue
    }

    if (!positionalOnly && arg.startsWith('--')) {
      const equals = arg.indexOf('=')
      const flag = equals >= 0 ? arg.slice(0, equals) : arg
      const inline = equals >= 0 ? arg.slice(equals + 1) : undefined

      switch (flag) {
        case '--contract': {
          const value = takeFlagValue(argv, i, flag, inline)
          parsed.contractFile = trimmedText(value.value, '--contract', 4096)
          i = value.nextIndex
          break
        }
        case '--accept': {
          const value = takeFlagValue(argv, i, flag, inline)
          parsed.accept.push(value.value)
          i = value.nextIndex
          break
        }
        case '--allow': {
          const value = takeFlagValue(argv, i, flag, inline)
          parsed.allow.push(value.value)
          i = value.nextIndex
          break
        }
        case '--constraint': {
          const value = takeFlagValue(argv, i, flag, inline)
          parsed.constraints.push(value.value)
          i = value.nextIndex
          break
        }
        case '--max-rounds': {
          const value = takeFlagValue(argv, i, flag, inline)
          parsed.maxRounds = parseIntegerFlag(value.value, flag, 0, 10)
          i = value.nextIndex
          break
        }
        case '--writer-mode': {
          const value = takeFlagValue(argv, i, flag, inline)
          parsed.writerMode = parseWriterMode(value.value, flag)
          i = value.nextIndex
          break
        }
        case '--timeout': {
          const value = takeFlagValue(argv, i, flag, inline)
          parsed.writerTimeoutSec = parseIntegerFlag(value.value, flag, 1, 86400)
          i = value.nextIndex
          break
        }
        case '--accept-timeout': {
          const value = takeFlagValue(argv, i, flag, inline)
          parsed.acceptTimeoutSec = parseIntegerFlag(value.value, flag, 1, 86400)
          i = value.nextIndex
          break
        }
        case '--max-turns': {
          const value = takeFlagValue(argv, i, flag, inline)
          parsed.writerMaxTurns = parseIntegerFlag(value.value, flag, 1, 500)
          i = value.nextIndex
          break
        }
        case '--writer-budget-usd': {
          const value = takeFlagValue(argv, i, flag, inline)
          parsed.writerBudgetUsd = parseBudgetFlag(value.value, flag)
          i = value.nextIndex
          break
        }
        case '--json':
        case '--verbose': {
          if (inline !== undefined) {
            throw new UsageError(`${flag} 不接受值`)
          }
          if (flag === '--json') parsed.json = true
          else parsed.verbose = true
          break
        }
        default:
          throw new UsageError(`未知参数: ${flag}`)
      }
      continue
    }

    if (!positionalOnly && arg.startsWith('-') && arg !== '-') {
      throw new UsageError(`未知参数: ${arg}`)
    }
    goalParts.push(arg)
  }

  const goal = goalParts.join(' ').trim()
  if (goal) parsed.goal = goal
  return parsed
}

export function loadContractFile(file: string): FileContract {
  let text: string
  try {
    const stat = statSync(file)
    if (!stat.isFile()) throw new UsageError(`契约文件不是普通文件: ${file}`)
    if (stat.size > MAX_CONTRACT_BYTES) {
      throw new UsageError(`契约文件超过 1 MiB: ${file}`)
    }
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error instanceof UsageError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new UsageError(`无法读取契约文件 ${file}: ${message}`)
  }

  if (Buffer.byteLength(text, 'utf8') > MAX_CONTRACT_BYTES) {
    throw new UsageError(`契约文件超过 1 MiB: ${file}`)
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new UsageError(`契约文件不是有效 JSON (${file}): ${message}`)
  }
  if (!isRecord(raw)) {
    throw new UsageError(`契约文件必须是 JSON 对象: ${file}`)
  }

  const contract: FileContract = {}

  if (raw.version !== undefined) {
    if (raw.version !== 1) {
      throw new UsageError(`不支持的契约版本: ${String(raw.version)}（只支持 1）`)
    }
    contract.version = 1
  }

  if (raw.goal !== undefined) {
    contract.goal = trimmedText(raw.goal, 'contract.goal', MAX_GOAL_CHARS)
  }

  if (raw.constraints !== undefined) {
    if (!Array.isArray(raw.constraints)) {
      throw new UsageError('contract.constraints 必须是字符串数组')
    }
    if (raw.constraints.length > MAX_CONSTRAINTS) {
      throw new UsageError(`contract.constraints 最多 ${MAX_CONSTRAINTS} 条`)
    }
    contract.constraints = raw.constraints.map((item, index) =>
      trimmedText(item, `contract.constraints[${index}]`, MAX_CONSTRAINT_CHARS),
    )
  }

  if (raw.allowedPaths !== undefined) {
    if (!Array.isArray(raw.allowedPaths)) {
      throw new UsageError('contract.allowedPaths 必须是字符串数组')
    }
    if (raw.allowedPaths.length > MAX_ALLOWED_PATHS) {
      throw new UsageError(`contract.allowedPaths 最多 ${MAX_ALLOWED_PATHS} 条`)
    }
    contract.allowedPaths = raw.allowedPaths.map((item, index) =>
      trimmedText(item, `contract.allowedPaths[${index}]`, 4096),
    )
  }

  if (raw.acceptance !== undefined) {
    if (!Array.isArray(raw.acceptance)) {
      throw new UsageError('contract.acceptance 必须是数组')
    }
    if (raw.acceptance.length > MAX_ACCEPTANCE_COMMANDS) {
      throw new UsageError(`contract.acceptance 最多 ${MAX_ACCEPTANCE_COMMANDS} 条`)
    }
    contract.acceptance = raw.acceptance.map((item, index) => {
      const label = `contract.acceptance[${index}]`
      if (typeof item === 'string') {
        return trimmedText(item, label, MAX_COMMAND_CHARS)
      }
      if (!isRecord(item)) {
        throw new UsageError(`${label} 必须是字符串或对象`)
      }
      const command = trimmedText(item.command, `${label}.command`, MAX_COMMAND_CHARS)
      const result: FileAcceptanceCommand = { command }
      if (item.name !== undefined) {
        result.name = trimmedText(item.name, `${label}.name`, 200)
      }
      if (item.timeoutSec !== undefined) {
        result.timeoutSec = integerInRange(
          item.timeoutSec,
          `${label}.timeoutSec`,
          1,
          86400,
        )
      }
      return result
    })
  }

  if (raw.maxRounds !== undefined) {
    contract.maxRounds = integerInRange(raw.maxRounds, 'contract.maxRounds', 0, 10)
  }
  if (raw.writerMode !== undefined) {
    contract.writerMode = parseWriterMode(raw.writerMode, 'contract.writerMode')
  }
  if (raw.writerTimeoutSec !== undefined) {
    contract.writerTimeoutSec = integerInRange(
      raw.writerTimeoutSec,
      'contract.writerTimeoutSec',
      1,
      86400,
    )
  }
  if (raw.acceptTimeoutSec !== undefined) {
    contract.acceptTimeoutSec = integerInRange(
      raw.acceptTimeoutSec,
      'contract.acceptTimeoutSec',
      1,
      86400,
    )
  }
  if (raw.writerMaxTurns !== undefined) {
    contract.writerMaxTurns = integerInRange(
      raw.writerMaxTurns,
      'contract.writerMaxTurns',
      1,
      500,
    )
  }
  if (raw.writerBudgetUsd !== undefined) {
    contract.writerBudgetUsd = positiveAmount(
      raw.writerBudgetUsd,
      'contract.writerBudgetUsd',
    )
  }

  return contract
}

function assertCount(items: string[], label: string, max: number): void {
  if (items.length > max) {
    throw new UsageError(`${label} 最多 ${max} 条`)
  }
}

function normalizeCommandList(commands: string[]): string[] {
  assertCount(commands, '--accept', MAX_ACCEPTANCE_COMMANDS)
  return commands.map((command, index) =>
    trimmedText(command, `--accept[${index}]`, MAX_COMMAND_CHARS),
  )
}

function normalizeConstraintList(constraints: string[]): string[] {
  assertCount(constraints, '--constraint', MAX_CONSTRAINTS)
  const result: string[] = []
  const seen = new Set<string>()
  for (const [index, constraint] of constraints.entries()) {
    const value = trimmedText(constraint, `--constraint[${index}]`, MAX_CONSTRAINT_CHARS)
    if (!seen.has(value)) {
      seen.add(value)
      result.push(value)
    }
  }
  return result
}

function resolveAcceptance(
  parsed: ParsedSuperviseArgs,
  file: FileContract | null,
  defaultTimeoutSec: number,
): AcceptanceCommand[] {
  if (parsed.accept.length > 0) {
    return normalizeCommandList(parsed.accept).map((command, index) => ({
      name: `acceptance ${index + 1}`,
      command,
      timeoutSec: defaultTimeoutSec,
    }))
  }

  if (file?.acceptance && file.acceptance.length > 0) {
    return file.acceptance.map((item, index) => {
      if (typeof item === 'string') {
        return {
          name: `acceptance ${index + 1}`,
          command: item,
          timeoutSec: defaultTimeoutSec,
        }
      }
      return {
        name: item.name ?? `acceptance ${index + 1}`,
        command: item.command,
        timeoutSec: item.timeoutSec ?? defaultTimeoutSec,
      }
    })
  }

  throw new UsageError('至少需要一条验收命令：使用 --accept，或在契约文件中提供 acceptance')
}

function resolveAllowedPaths(
  parsed: ParsedSuperviseArgs,
  file: FileContract | null,
): string[] {
  const raw = parsed.allow.length > 0 ? parsed.allow : (file?.allowedPaths ?? [])
  if (raw.length === 0) {
    throw new UsageError('至少需要一个允许路径：使用 --allow（. 表示整个仓库）')
  }
  assertCount(raw, '--allow', MAX_ALLOWED_PATHS)

  const result: string[] = []
  const seen = new Set<string>()
  for (const [index, item] of raw.entries()) {
    const path = normalizeAllowedPath(
      trimmedText(item, `--allow[${index}]`, 4096),
    )
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    if (!seen.has(key)) {
      seen.add(key)
      result.push(path)
    }
  }
  return result
}

export function resolveContract(
  parsed: ParsedSuperviseArgs,
  file: FileContract | null,
): ResolvedContract {
  const goal = trimmedText(
    parsed.goal ?? file?.goal ?? '',
    '任务目标（位置参数或 contract.goal）',
    MAX_GOAL_CHARS,
  )

  const acceptTimeoutSec =
    parsed.acceptTimeoutSec ?? file?.acceptTimeoutSec ?? DEFAULT_ACCEPT_TIMEOUT_SEC
  integerInRange(acceptTimeoutSec, '--accept-timeout', 1, 86400)

  const acceptance = resolveAcceptance(parsed, file, acceptTimeoutSec)
  const allowedPaths = resolveAllowedPaths(parsed, file)

  const constraints = normalizeConstraintList(
    parsed.constraints.length > 0 ? parsed.constraints : (file?.constraints ?? []),
  )

  const maxRounds =
    parsed.maxRounds ?? file?.maxRounds ?? DEFAULT_MAX_ROUNDS
  integerInRange(maxRounds, '--max-rounds', 0, 10)

  const writerMode =
    parsed.writerMode ?? file?.writerMode ?? ('bypass' as WriterMode)

  const writerTimeoutSec =
    parsed.writerTimeoutSec ?? file?.writerTimeoutSec ?? DEFAULT_WRITER_TIMEOUT_SEC
  integerInRange(writerTimeoutSec, '--timeout', 1, 86400)

  const writerMaxTurns =
    parsed.writerMaxTurns ?? file?.writerMaxTurns ?? DEFAULT_WRITER_MAX_TURNS
  integerInRange(writerMaxTurns, '--max-turns', 1, 500)

  const writerBudgetUsd = parsed.writerBudgetUsd ?? file?.writerBudgetUsd
  if (writerBudgetUsd !== undefined) {
    positiveAmount(writerBudgetUsd, '--writer-budget-usd')
  }

  const hashPayload = {
    goal,
    constraints,
    allowedPaths,
    acceptance,
    maxRounds,
    writerMode,
    writerTimeoutSec,
    acceptTimeoutSec,
    writerMaxTurns,
    writerBudgetUsd: writerBudgetUsd ?? null,
  }
  const contractHash = createHash('sha256')
    .update(JSON.stringify(stableValue(hashPayload)))
    .digest('hex')

  return {
    goal,
    constraints,
    allowedPaths,
    acceptance,
    maxRounds,
    writerMode,
    writerTimeoutSec,
    acceptTimeoutSec,
    writerMaxTurns,
    writerBudgetUsd,
    contractHash,
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (isRecord(value)) {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      result[key] = stableValue(value[key])
    }
    return result
  }
  return value
}

/**
 * Allowed paths are repo-relative POSIX paths. `.` means the whole repository.
 * Glob metacharacters, absolute paths, backslashes, `.git`, and `.lab` are
 * rejected so the allowlist stays unambiguous across platforms.
 */
export function normalizeAllowedPath(raw: string): string {
  if (raw.includes('\0')) throw new UsageError('允许路径不能包含 NUL')
  if (raw.includes('\\')) {
    throw new UsageError(`允许路径必须使用 / 分隔符: ${raw}`)
  }
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    throw new UsageError('允许路径不能包含控制字符')
  }
  if (raw === '.') return '.'
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    throw new UsageError(`允许路径必须是仓库相对路径: ${raw}`)
  }

  const withoutPrefix = raw.replace(/^\.\//, '').replace(/\/+$/, '')
  if (!withoutPrefix) {
    throw new UsageError(`无效的允许路径: ${raw}`)
  }
  if (/[*?[\]{}!]/.test(withoutPrefix)) {
    throw new UsageError(`允许路径不支持通配符: ${raw}`)
  }
  if (withoutPrefix.includes(':')) {
    throw new UsageError(`允许路径不能包含冒号: ${raw}`)
  }

  const segments = withoutPrefix.split('/')
  for (const segment of segments) {
    if (!segment) throw new UsageError(`允许路径包含空段: ${raw}`)
    if (segment === '.' || segment === '..') {
      throw new UsageError(`允许路径不能包含 . 或 ..: ${raw}`)
    }
    if (segment === '.git') {
      throw new UsageError(`允许路径不能包含 .git: ${raw}`)
    }
  }
  if (segments[0] === '.lab') {
    throw new UsageError(`允许路径不能包含 .lab: ${raw}`)
  }
  return segments.join('/')
}

export function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

export function isPathAllowed(
  path: string,
  allowedPaths: string[],
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (allowedPaths.includes('.')) return true
  const targetPath = normalizeRepoPath(path)
  const caseInsensitive = platform === 'win32'
  const target = caseInsensitive ? targetPath.toLowerCase() : targetPath
  return allowedPaths.some((allowed) => {
    const normalized = normalizeRepoPath(allowed).replace(/\/+$/, '')
    const base = caseInsensitive ? normalized.toLowerCase() : normalized
    return target === base || target.startsWith(`${base}/`)
  })
}

export function isSensitiveRepoPath(path: string): boolean {
  const name = normalizeRepoPath(path).split('/').pop()?.toLowerCase() ?? ''
  return (
    name === '.env' ||
    name === '.env.local' ||
    /^\.env\..+\.local$/.test(name) ||
    name === '.lab-agent.env' ||
    name.endsWith('.pem') ||
    name.endsWith('.key') ||
    name.startsWith('id_rsa') ||
    name.startsWith('id_ed25519')
  )
}

export function isPathInside(
  parent: string,
  child: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const normalizedParent = resolve(parent)
  const normalizedChild = resolve(child)
  const caseInsensitive = platform === 'win32'
  const parentValue = caseInsensitive
    ? normalizedParent.toLowerCase()
    : normalizedParent
  const childValue = caseInsensitive ? normalizedChild.toLowerCase() : normalizedChild
  if (childValue === parentValue) return true
  return childValue.startsWith(
    parentValue.endsWith(sep) ? parentValue : `${parentValue}${sep}`,
  )
}
