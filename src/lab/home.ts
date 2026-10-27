import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, normalize } from 'node:path'

export const LAB_CONFIG_DIR = '.lab-agent'
export const LAB_ENV_FILENAME = '.env'

const PLACEHOLDER_KEYS = new Set([
  '',
  'sk-在此粘贴你的密钥',
  'sk-在此粘贴你的DeepSeek密钥',
  'sk-your-key-here',
])

export interface LabConfigPaths {
  home: string
  envFile: string
}

export function resolveConfigHome(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir(),
): string {
  const explicit = env.LAB_AGENT_HOME?.trim()
  if (explicit && isAbsolute(explicit)) return normalize(explicit)
  return join(homeDir, LAB_CONFIG_DIR)
}

export function ensureConfigHome(
  env: NodeJS.ProcessEnv = process.env,
): LabConfigPaths {
  const home = resolveConfigHome(env)
  mkdirSync(home, { recursive: true })
  return { home, envFile: join(home, LAB_ENV_FILENAME) }
}

export function resolveEnvFile(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveConfigHome(env), LAB_ENV_FILENAME)
}

/**
 * Minimal dotenv parser. Supports `export KEY=value`, quoted values, and
 * comments. It deliberately does not interpolate variables.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2]!.trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    result[match[1]!] = value
  }
  return result
}

/** Load an env file without overriding variables already set by the shell. */
export function loadEnvFile(
  file: string,
  target: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  if (!existsSync(file)) return {}
  const parsed = parseEnvFile(readFileSync(file, 'utf8'))
  for (const [key, value] of Object.entries(parsed)) {
    if (target[key] === undefined) target[key] = value
  }
  return parsed
}

export function isRealApiKey(value: string | undefined): boolean {
  return !!value && !PLACEHOLDER_KEYS.has(value.trim())
}

export type LabApiKeySource =
  | 'DEEPSEEK_API_KEY'
  | 'API_KEY'
  | 'ANTHROPIC_AUTH_TOKEN'
  | 'ANTHROPIC_API_KEY'

export interface ResolvedApiKey {
  key: string
  source: LabApiKeySource
}

export function resolveApiKeySource(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedApiKey | undefined {
  const candidates: LabApiKeySource[] = [
    'DEEPSEEK_API_KEY',
    'API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_API_KEY',
  ]
  for (const source of candidates) {
    const value = env[source]
    if (isRealApiKey(value)) return { key: value!.trim(), source }
  }
  return undefined
}

export function resolveApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return resolveApiKeySource(env)?.key
}

/** DeepSeek's Anthropic-compatible endpoint lives under /anthropic. */
export function normalizeBaseUrl(raw: string): string {
  let base = raw.trim().replace(/\/+$/, '')
  if (base.endsWith('/v1')) base = base.slice(0, -3)
  if (/deepseek\.com/i.test(base) && !base.endsWith('/anthropic')) {
    base += '/anthropic'
  }
  return base
}

/**
 * Map Lab Agent's friendly provider variables onto the Anthropic-compatible
 * variables the engine already understands.
 */
export function normalizeProviderEnv(env: NodeJS.ProcessEnv = process.env): void {
  const resolved = resolveApiKeySource(env)
  const rawBase = (env.BASE_URL || env.ANTHROPIC_BASE_URL || 'https://api.deepseek.com').trim()
  const base = normalizeBaseUrl(rawBase)
  const isOfficialAnthropic = /(^|\/\/)api\.anthropic\.com/i.test(base)
  const defaultModel = isOfficialAnthropic ? 'claude-sonnet-5-5' : 'deepseek-flash'
  const model = (env.MODEL || env.ANTHROPIC_MODEL || defaultModel).trim() || defaultModel

  if (resolved) {
    // The official Anthropic API expects x-api-key. Anthropic-compatible
    // proxies (DeepSeek included) expect Authorization: Bearer.
    if (
      resolved.source === 'ANTHROPIC_API_KEY' ||
      /(^|\/\/)api\.anthropic\.com/i.test(base)
    ) {
      env.ANTHROPIC_API_KEY = resolved.key
    } else {
      env.ANTHROPIC_AUTH_TOKEN = resolved.key
    }
    if (resolved.source === 'DEEPSEEK_API_KEY') {
      env.DEEPSEEK_API_KEY ??= resolved.key
    }
  }

  env.ANTHROPIC_BASE_URL = base
  env.ANTHROPIC_MODEL = model
  env.ANTHROPIC_DEFAULT_OPUS_MODEL ??= model
  env.ANTHROPIC_DEFAULT_SONNET_MODEL ??= model
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL ??= model
  env.CLAUDE_CODE_SUBAGENT_MODEL ??= model
  env.BASE_URL ??= rawBase.replace(/\/+$/, '')
  env.MODEL ??= model
}

/** Apply Lab Agent's profile + provider settings before the engine starts. */
export function applyLabEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): LabConfigPaths {
  const paths = ensureConfigHome(env)
  // Project config overrides the profile, while real shell variables override
  // both (loadEnvFile never replaces a variable that is already defined).
  loadEnvFile(join(process.cwd(), '.lab-agent.env'), env)
  loadEnvFile(paths.envFile, env)

  env.LAB_AGENT_HOME = paths.home
  env.CLAUDE_CONFIG_DIR = paths.home
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC ??= '1'
  env.DISABLE_TELEMETRY ??= '1'
  normalizeProviderEnv(env)
  return paths
}

export function writeEnvFile(
  file: string,
  values: Record<string, string>,
): void {
  const lines = [
    '# Lab Agent CLI configuration (generated by `lab setup`)',
    '# This file contains an API key. Keep it out of version control.',
    '',
  ]
  const known = [
    'DEEPSEEK_API_KEY',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'BASE_URL',
    'MODEL',
  ]
  for (const key of known) {
    if (values[key] !== undefined) lines.push(`${key}=${values[key]}`)
  }
  const extras = Object.entries(values)
    .filter(([key]) => !known.includes(key))
    .sort(([a], [b]) => a.localeCompare(b))
  if (extras.length > 0) {
    lines.push('')
    for (const [key, value] of extras) lines.push(`${key}=${value}`)
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(file, 0o600)
  } catch {
    // Windows does not support POSIX modes; the file is still user-scoped.
  }
}

export function maskSecret(value: string | undefined): string {
  if (!value) return '(not set)'
  if (value.length <= 8) return '*'.repeat(value.length)
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}
