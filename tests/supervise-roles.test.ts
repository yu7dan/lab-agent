import { describe, expect, test } from 'bun:test'
import { UsageError } from '../src/lab/supervise/errors.js'
import {
  buildAuditorConfig,
  buildAuditorEnv,
  buildAuditorSettings,
  buildWriterEnv,
  buildWriterSettings,
} from '../src/lab/supervise/roles.js'

describe('buildWriterEnv', () => {
  test('removes auditor overrides but keeps writer credentials', () => {
    const env = buildWriterEnv({
      PATH: '/bin',
      DEEPSEEK_API_KEY: 'sk-writer',
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      LAB_AUDITOR_API_KEY: 'audit-key',
      LAB_AUDITOR_MODEL: 'audit-model',
    })
    expect(env.PATH).toBe('/bin')
    expect(env.DEEPSEEK_API_KEY).toBe('sk-writer')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.deepseek.com/anthropic')
    expect(env.LAB_AUDITOR_API_KEY).toBeUndefined()
    expect(env.LAB_AUDITOR_MODEL).toBeUndefined()
  })
})

describe('supervise settings', () => {
  test('writer denies private homes, artifacts, and secrets', () => {
    const settings = buildWriterSettings()
    const deny = settings.permissions.deny.join('\n')
    expect(deny).toContain('Read(~/.claude/**)')
    expect(deny).toContain('Read(~/.lab-agent/**)')
    expect(deny).toContain('Read(.lab/tasks/**)')
    expect(deny).toContain('Read(**/.env)')
    expect(deny).toContain('Bash(*.claude*)')
    expect(settings.disableAllHooks).toBeUndefined()
  })

  test('auditor disables hooks and denies private homes, git, lab, and secrets', () => {
    const settings = buildAuditorSettings()
    const deny = settings.permissions.deny.join('\n')
    expect(settings.disableAllHooks).toBe(true)
    expect(deny).toContain('Read(~/.claude/**)')
    expect(deny).toContain('Read(~/.lab-agent/**)')
    expect(deny).toContain('Read(.git/**)')
    expect(deny).toContain('Read(.lab/**)')
    expect(deny).toContain('Read(.lab-agent.env)')
    expect(deny).toContain('Glob(**/id_ed25519*)')
  })
})

describe('buildAuditorConfig', () => {
  test('inherits the writer provider by default', () => {
    const config = buildAuditorConfig({
      DEEPSEEK_API_KEY: 'sk-writer',
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com',
      ANTHROPIC_MODEL: 'deepseek-writer',
    })
    expect(config).toEqual({
      model: 'deepseek-writer',
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiKey: 'sk-writer',
      maxTurns: 20,
      timeoutSec: 600,
      budgetUsd: undefined,
    })
  })

  test('uses official Anthropic defaults for the official endpoint', () => {
    const config = buildAuditorConfig({
      ANTHROPIC_API_KEY: 'sk-ant',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    })
    expect(config.model).toBe('claude-sonnet-5-5')
    expect(config.baseUrl).toBe('https://api.anthropic.com')
  })

  test('honors LAB_AUDITOR_* overrides', () => {
    const config = buildAuditorConfig({
      DEEPSEEK_API_KEY: 'sk-writer',
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com',
      LAB_AUDITOR_API_KEY: 'audit-key',
      LAB_AUDITOR_BASE_URL: 'https://audit.example.com/v1',
      LAB_AUDITOR_MODEL: 'audit-model',
      LAB_AUDITOR_MAX_TURNS: '30',
      LAB_AUDITOR_TIMEOUT_SEC: '120',
      LAB_AUDITOR_MAX_BUDGET_USD: '4.5',
    })
    expect(config).toEqual({
      model: 'audit-model',
      baseUrl: 'https://audit.example.com',
      apiKey: 'audit-key',
      maxTurns: 30,
      timeoutSec: 120,
      budgetUsd: 4.5,
    })
  })

  test('rejects missing keys and invalid values', () => {
    expect(() => buildAuditorConfig({})).toThrow(UsageError)
    expect(() =>
      buildAuditorConfig({
        DEEPSEEK_API_KEY: 'sk-writer',
        LAB_AUDITOR_MAX_TURNS: 'abc',
      }),
    ).toThrow(UsageError)
    expect(() =>
      buildAuditorConfig({
        DEEPSEEK_API_KEY: 'sk-writer',
        LAB_AUDITOR_MAX_TURNS: '0',
      }),
    ).toThrow(UsageError)
    expect(() =>
      buildAuditorConfig({
        DEEPSEEK_API_KEY: 'sk-writer',
        LAB_AUDITOR_TIMEOUT_SEC: '999999',
      }),
    ).toThrow(UsageError)
    expect(() =>
      buildAuditorConfig({
        DEEPSEEK_API_KEY: 'sk-writer',
        LAB_AUDITOR_MAX_BUDGET_USD: '-1',
      }),
    ).toThrow(UsageError)
    expect(() =>
      buildAuditorConfig({
        DEEPSEEK_API_KEY: 'sk-writer',
        LAB_AUDITOR_BASE_URL: 'ftp://example.com',
      }),
    ).toThrow(UsageError)
    expect(() =>
      buildAuditorConfig({
        DEEPSEEK_API_KEY: 'sk-writer',
        LAB_AUDITOR_BASE_URL: 'not a url',
      }),
    ).toThrow(UsageError)
  })
})

describe('buildAuditorEnv', () => {
  test('keeps exactly one non-official credential and overwrites model tiers', () => {
    const env = buildAuditorEnv(
      {
        PATH: '/bin',
        DEEPSEEK_API_KEY: 'sk-writer',
        API_KEY: 'api-key',
        ANTHROPIC_API_KEY: 'sk-ant-writer',
        ANTHROPIC_AUTH_TOKEN: 'writer-token',
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        ANTHROPIC_MODEL: 'writer-model',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'opus-writer',
        LAB_AUDITOR_API_KEY: 'audit-key',
        LAB_AUDITOR_MODEL: 'audit-model',
      },
      {
        model: 'audit-model',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: 'audit-key',
        maxTurns: 20,
        timeoutSec: 600,
      },
    )

    expect(env.PATH).toBe('/bin')
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()
    expect(env.API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('audit-key')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.deepseek.com/anthropic')
    expect(env.ANTHROPIC_MODEL).toBe('audit-model')
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('audit-model')
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('audit-model')
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('audit-model')
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('audit-model')
    expect(env.BASE_URL).toBe('https://api.deepseek.com/anthropic')
    expect(env.MODEL).toBe('audit-model')
    expect(env.LAB_AUDITOR_API_KEY).toBeUndefined()
    expect(env.LAB_AUDITOR_MODEL).toBeUndefined()
  })

  test('uses ANTHROPIC_API_KEY for the official endpoint', () => {
    const env = buildAuditorEnv(
      { ANTHROPIC_AUTH_TOKEN: 'writer-token' },
      {
        model: 'claude-sonnet-5-5',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-ant-audit',
        maxTurns: 20,
        timeoutSec: 600,
      },
    )
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-audit')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
  })
})
