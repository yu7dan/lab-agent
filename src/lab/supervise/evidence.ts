import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import {
  isPathAllowed,
  isPathInside,
  isSensitiveRepoPath,
  normalizeRepoPath,
} from './contract.js'
import type { GitStatusEntry } from './git.js'
import type {
  AcceptanceResult,
  AcceptanceSummary,
  PathViolation,
} from './types.js'

export type Redactor = (text: string) => string

const SECRET_ENV_NAMES = [
  'DEEPSEEK_API_KEY',
  'API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'LAB_AUDITOR_API_KEY',
]

/** Collect configured credentials so every artifact can be scrubbed. */
export function collectSecrets(...envs: NodeJS.ProcessEnv[]): string[] {
  const secrets = new Set<string>()
  for (const env of envs) {
    for (const name of SECRET_ENV_NAMES) {
      const value = env[name]?.trim()
      if (value && value.length >= 8) secrets.add(value)
    }
  }
  return [...secrets].sort((a, b) => b.length - a.length)
}

export function createRedactor(secrets: string[]): Redactor {
  const exact = [...new Set(secrets.filter((secret) => secret.length >= 8))].sort(
    (a, b) => b.length - a.length,
  )
  return (text: string): string => {
    let result = text
    for (const secret of exact) {
      if (result.includes(secret)) {
        result = result.split(secret).join('[REDACTED]')
      }
    }
    result = result.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]')
    result = result.replace(
      /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
      'Bearer [REDACTED]',
    )
    return result
  }
}

function redactValue(
  value: unknown,
  redact: Redactor,
  seen: WeakMap<object, unknown>,
): unknown {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) {
    const cached = seen.get(value)
    if (cached !== undefined) return cached
    const result: unknown[] = []
    seen.set(value, result)
    for (const item of value) result.push(redactValue(item, redact, seen))
    return result
  }
  if (value && typeof value === 'object') {
    const cached = seen.get(value)
    if (cached !== undefined) return cached
    const result: Record<string, unknown> = {}
    seen.set(value, result)
    for (const [key, item] of Object.entries(value)) {
      result[key] = redactValue(item, redact, seen)
    }
    return result
  }
  return value
}

/** Deep-scrub strings in a JSON-like value (verdicts, reports). */
export function redactDeep<T>(value: T, redact: Redactor): T {
  return redactValue(value, redact, new WeakMap()) as T
}

/** Remove ANSI escapes and C0 control characters from text shown in a terminal. */
export function sanitizeTerminalText(text: string): string {
  return text
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-_]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n?/g, '\n')
}

export function truncateText(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  if (maxChars <= 80) {
    return {
      text: `${text.slice(0, Math.max(0, maxChars - 20))}\n...[truncated]`,
      truncated: true,
    }
  }
  const head = Math.floor(maxChars * 0.65)
  const tail = Math.floor(maxChars * 0.25)
  const omitted = text.length - head - tail
  return {
    text: `${text.slice(0, head)}\n... [truncated ${omitted} chars] ...\n${text.slice(-tail)}`,
    truncated: true,
  }
}

export function toAcceptanceSummary(result: AcceptanceResult): AcceptanceSummary {
  return {
    name: result.name,
    command: result.command,
    code: result.code,
    signal: result.signal,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    stdoutBytes: Buffer.byteLength(result.stdout, 'utf8'),
    stderrBytes: Buffer.byteLength(result.stderr, 'utf8'),
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
    ok: result.ok,
  }
}

export interface ChangeAnalysisInput {
  repoRoot: string
  changedPaths: string[]
  statusEntries: GitStatusEntry[]
  allowedPaths: string[]
  maxChangedPaths?: number
}

export interface ChangeAnalysis {
  changedPaths: string[]
  pathViolations: PathViolation[]
  sensitivePaths: string[]
}

function unsafeGitPath(path: string): boolean {
  if (path.startsWith('/')) return true
  if (/^[A-Za-z]:/.test(path)) return true
  return path.split('/').some((segment) => segment === '..' || segment === '')
}

function pathEscapesRepo(repoRoot: string, repoPath: string): boolean {
  try {
    const absolute = join(repoRoot, ...repoPath.split('/'))
    const realRoot = realpathSync(repoRoot)
    const target = realpathSync(absolute)
    return !isPathInside(realRoot, target)
  } catch {
    // Missing/broken paths cannot leak data and deleted paths are normal.
    return false
  }
}

/**
 * Classify changed paths. Sensitive paths are always violations, even if the
 * allowlist includes them. Symlinks are checked with realpath so a link (or a
 * file under a symlinked directory) cannot point outside the repository.
 */
export function analyzeChanges(input: ChangeAnalysisInput): ChangeAnalysis {
  const maxChangedPaths = input.maxChangedPaths ?? 500
  const changedPaths: string[] = []
  const seenPaths = new Set<string>()
  for (const raw of input.changedPaths) {
    const path = normalizeRepoPath(raw)
    if (!seenPaths.has(path)) {
      seenPaths.add(path)
      changedPaths.push(path)
    }
  }

  const violations: PathViolation[] = []
  const violationKeys = new Set<string>()
  const sensitive = new Set<string>()

  const addViolation = (
    path: string,
    reason: PathViolation['reason'],
    detail?: string,
  ): void => {
    const key = `${path}\0${reason}`
    if (violationKeys.has(key)) return
    violationKeys.add(key)
    violations.push({ path, reason, ...(detail ? { detail } : {}) })
  }

  for (const entry of input.statusEntries) {
    for (const path of [entry.path, entry.oldPath]) {
      if (!path) continue
      const normalized = normalizeRepoPath(path)
      if (isSensitiveRepoPath(normalized)) {
        sensitive.add(normalized)
        addViolation(normalized, 'sensitive', '敏感文件不允许被修改或新增')
      }
    }
  }

  if (changedPaths.length > maxChangedPaths) {
    addViolation(
      '',
      'too-many-paths',
      `单轮改动 ${changedPaths.length} 个文件，超过上限 ${maxChangedPaths}`,
    )
  }

  for (const path of changedPaths) {
    if (unsafeGitPath(path)) {
      addViolation(path, 'not-allowed', '路径不是安全的仓库相对路径')
      continue
    }
    if (isSensitiveRepoPath(path)) {
      sensitive.add(path)
      addViolation(path, 'sensitive', '敏感文件不允许被修改或新增')
      continue
    }
    if (!isPathAllowed(path, input.allowedPaths)) {
      addViolation(path, 'not-allowed', '不在允许路径内')
    }
    if (pathEscapesRepo(input.repoRoot, path)) {
      addViolation(path, 'symlink-escape', 'symlink 指向仓库外部')
    }
  }

  return {
    changedPaths,
    pathViolations: violations,
    sensitivePaths: [...sensitive].sort(),
  }
}
