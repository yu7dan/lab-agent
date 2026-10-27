import {
  isRealApiKey,
  normalizeBaseUrl,
  resolveApiKey,
} from '../home.js'
import { UsageError } from './errors.js'
import type { AuditorConfig } from './types.js'

const CLAUDE_HOME_DENIES = [
  'Read(~/.claude)',
  'Read(~/.claude/**)',
  'Grep(~/.claude)',
  'Grep(~/.claude/**)',
  'Glob(~/.claude)',
  'Glob(~/.claude/**)',
  'Bash(*.claude*)',
  'PowerShell(*.claude*)',
]

const LAB_HOME_DENIES = [
  'Read(~/.lab-agent)',
  'Read(~/.lab-agent/**)',
  'Grep(~/.lab-agent)',
  'Grep(~/.lab-agent/**)',
  'Glob(~/.lab-agent)',
  'Glob(~/.lab-agent/**)',
  'Bash(*.lab-agent*)',
  'PowerShell(*.lab-agent*)',
]

const TASK_ARTIFACT_DENIES = [
  'Read(.lab/tasks)',
  'Read(.lab/tasks/**)',
  'Grep(.lab/tasks)',
  'Grep(.lab/tasks/**)',
  'Glob(.lab/tasks)',
  'Glob(.lab/tasks/**)',
  'Bash(*.lab/tasks*)',
  'PowerShell(*.lab/tasks*)',
]

const SECRET_PATH_DENIES = [
  'Read(.env)',
  'Read(.env.local)',
  'Read(.env.*.local)',
  'Read(.lab-agent.env)',
  'Read(**/.env)',
  'Read(**/.env.local)',
  'Read(**/.env.*.local)',
  'Read(**/.lab-agent.env)',
  'Read(**/*.pem)',
  'Read(**/*.key)',
  'Read(**/id_rsa*)',
  'Read(**/id_ed25519*)',
  'Grep(.env)',
  'Grep(.env.local)',
  'Grep(.env.*.local)',
  'Grep(.lab-agent.env)',
  'Grep(**/.env)',
  'Grep(**/.env.local)',
  'Grep(**/.env.*.local)',
  'Grep(**/.lab-agent.env)',
  'Grep(**/*.pem)',
  'Grep(**/*.key)',
  'Grep(**/id_rsa*)',
  'Grep(**/id_ed25519*)',
  'Glob(.env)',
  'Glob(.env.local)',
  'Glob(.env.*.local)',
  'Glob(.lab-agent.env)',
  'Glob(**/.env)',
  'Glob(**/.env.local)',
  'Glob(**/.env.*.local)',
  'Glob(**/.lab-agent.env)',
  'Glob(**/*.pem)',
  'Glob(**/*.key)',
  'Glob(**/id_rsa*)',
  'Glob(**/id_ed25519*)',
]

const READ_ONLY_DENIES = [
  'Read(.git)',
  'Read(.git/**)',
  'Grep(.git)',
  'Grep(.git/**)',
  'Glob(.git)',
  'Glob(.git/**)',
  'Read(.lab)',
  'Read(.lab/**)',
  'Grep(.lab)',
  'Grep(.lab/**)',
  'Glob(.lab)',
  'Glob(.lab/**)',
]

export interface SuperviseSettings {
  disableAllHooks?: boolean
  permissions: {
    deny: string[]
  }
}

/**
 * The writer gets the normal engine environment minus auditor credentials.
 * `--settings` suppresses Lab's automatic memory guard, so the settings file
 * repeats the `~/.claude` and `~/.lab-agent` denies explicitly.
 */
export function buildWriterEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv }
  for (const key of Object.keys(env)) {
    if (key.startsWith('LAB_AUDITOR_')) delete env[key]
  }
  return env
}

export function buildWriterSettings(): SuperviseSettings {
  return {
    permissions: {
      deny: [
        ...CLAUDE_HOME_DENIES,
        ...LAB_HOME_DENIES,
        ...TASK_ARTIFACT_DENIES,
        ...SECRET_PATH_DENIES,
      ],
    },
  }
}

export function buildAuditorSettings(): SuperviseSettings {
  return {
    disableAllHooks: true,
    permissions: {
      deny: [
        ...CLAUDE_HOME_DENIES,
        ...LAB_HOME_DENIES,
        ...READ_ONLY_DENIES,
        ...SECRET_PATH_DENIES,
      ],
    },
  }
}

function readIntegerEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  if (!/^\d+$/.test(raw)) {
    throw new UsageError(`${name} 必须是整数`)
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new UsageError(`${name} 必须在 ${min}..${max} 之间`)
  }
  return value
}

function readAmountEnv(
  env: NodeJS.ProcessEnv,
  name: string,
): number | undefined {
  const raw = env[name]?.trim()
  if (!raw) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new UsageError(`${name} 必须是正数`)
  }
  return value
}

function validateBaseUrl(raw: string): string {
  const normalized = normalizeBaseUrl(raw)
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new UsageError(`无效的端点 URL: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError(`端点 URL 必须是 http(s): ${raw}`)
  }
  return normalized
}

export function buildAuditorConfig(env: NodeJS.ProcessEnv): AuditorConfig {
  const baseUrl = validateBaseUrl(
    env.LAB_AUDITOR_BASE_URL?.trim() ||
      env.ANTHROPIC_BASE_URL?.trim() ||
      env.BASE_URL?.trim() ||
      'https://api.deepseek.com',
  )
  const isOfficialAnthropic = /(^|\/\/)api\.anthropic\.com/i.test(baseUrl)
  const model =
    env.LAB_AUDITOR_MODEL?.trim() ||
    env.ANTHROPIC_MODEL?.trim() ||
    (isOfficialAnthropic ? 'claude-sonnet-5-5' : 'deepseek-flash')

  const explicitAuditorKey = env.LAB_AUDITOR_API_KEY?.trim()
  const apiKey =
    explicitAuditorKey && isRealApiKey(explicitAuditorKey)
      ? explicitAuditorKey
      : resolveApiKey(env)
  if (!apiKey) {
    throw new UsageError(
      '未配置 auditor API Key。请配置 DEEPSEEK_API_KEY / ANTHROPIC_API_KEY，' +
        '或设置 LAB_AUDITOR_API_KEY。',
    )
  }

  return {
    model,
    baseUrl,
    apiKey,
    maxTurns: readIntegerEnv(env, 'LAB_AUDITOR_MAX_TURNS', 20, 1, 500),
    timeoutSec: readIntegerEnv(env, 'LAB_AUDITOR_TIMEOUT_SEC', 600, 1, 86400),
    budgetUsd: readAmountEnv(env, 'LAB_AUDITOR_MAX_BUDGET_USD'),
  }
}

/**
 * Build the auditor child environment. The auditor inherits the writer's
 * provider by default, but only one credential variable is present and all
 * `LAB_AUDITOR_*` variables are removed. The tier defaults are overwritten
 * explicitly because home.ts uses `??=` when normalizing providers.
 */
export function buildAuditorEnv(
  baseEnv: NodeJS.ProcessEnv,
  config: AuditorConfig,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv }
  for (const key of Object.keys(env)) {
    if (key.startsWith('LAB_AUDITOR_')) delete env[key]
  }
  delete env.DEEPSEEK_API_KEY
  delete env.API_KEY
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN

  env.ANTHROPIC_BASE_URL = config.baseUrl
  env.ANTHROPIC_MODEL = config.model
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = config.model
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = config.model
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = config.model
  env.CLAUDE_CODE_SUBAGENT_MODEL = config.model
  env.BASE_URL = config.baseUrl
  env.MODEL = config.model

  if (/(^|\/\/)api\.anthropic\.com/i.test(config.baseUrl)) {
    env.ANTHROPIC_API_KEY = config.apiKey
  } else {
    env.ANTHROPIC_AUTH_TOKEN = config.apiKey
  }
  return env
}
