import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyLabEnvironment,
  maskSecret,
  normalizeBaseUrl,
  normalizeProviderEnv,
  parseEnvFile,
  resolveApiKey,
  resolveApiKeySource,
  resolveConfigHome,
  writeEnvFile,
} from '../src/lab/home.js'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lab-agent-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('parseEnvFile', () => {
  test('parses exports, quotes, comments, and blank lines', () => {
    const parsed = parseEnvFile(`
# comment
export DEEPSEEK_API_KEY="sk-abc"
BASE_URL=https://api.deepseek.com
MODEL='deepseek-flash'
INVALID LINE
EMPTY=
`)
    expect(parsed).toEqual({
      DEEPSEEK_API_KEY: 'sk-abc',
      BASE_URL: 'https://api.deepseek.com',
      MODEL: 'deepseek-flash',
      EMPTY: '',
    })
  })
})

describe('resolveConfigHome', () => {
  test('uses an absolute LAB_AGENT_HOME override', () => {
    const home = makeTempDir()
    expect(resolveConfigHome({ LAB_AGENT_HOME: home }, '/ignored')).toBe(
      home,
    )
  })

  test('ignores a relative override', () => {
    expect(
      resolveConfigHome({ LAB_AGENT_HOME: './relative' }, '/home/user'),
    ).toBe(join('/home/user', '.lab-agent'))
  })

  test('defaults to ~/.lab-agent', () => {
    expect(resolveConfigHome({}, '/home/user')).toBe(
      join('/home/user', '.lab-agent'),
    )
  })
})

describe('normalizeBaseUrl', () => {
  test('adds /anthropic for DeepSeek and removes trailing slashes', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com/')).toBe(
      'https://api.deepseek.com/anthropic',
    )
    expect(normalizeBaseUrl('https://api.deepseek.com/v1')).toBe(
      'https://api.deepseek.com/anthropic',
    )
    expect(normalizeBaseUrl('https://api.deepseek.com/anthropic/')).toBe(
      'https://api.deepseek.com/anthropic',
    )
  })

  test('leaves other endpoints alone', () => {
    expect(normalizeBaseUrl('https://api.anthropic.com/')).toBe(
      'https://api.anthropic.com',
    )
    expect(normalizeBaseUrl('http://localhost:8080/')).toBe(
      'http://localhost:8080',
    )
  })
})

describe('API key resolution', () => {
  test('ignores placeholders and picks the first real key', () => {
    expect(
      resolveApiKey({
        DEEPSEEK_API_KEY: 'sk-在此粘贴你的密钥',
        ANTHROPIC_API_KEY: 'sk-ant-real',
      }),
    ).toBe('sk-ant-real')

    expect(
      resolveApiKeySource({
        ANTHROPIC_AUTH_TOKEN: 'proxy-token',
        ANTHROPIC_API_KEY: 'sk-ant-real',
      }),
    ).toEqual({ key: 'proxy-token', source: 'ANTHROPIC_AUTH_TOKEN' })
  })

  test('returns undefined when nothing is configured', () => {
    expect(resolveApiKey({})).toBeUndefined()
  })
})

describe('normalizeProviderEnv', () => {
  test('maps DeepSeek to the Anthropic-compatible endpoint', () => {
    const env: NodeJS.ProcessEnv = {
      DEEPSEEK_API_KEY: 'sk-ds',
      BASE_URL: 'https://api.deepseek.com',
      MODEL: 'deepseek-chat',
    }
    normalizeProviderEnv(env)

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-ds')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.deepseek.com/anthropic')
    expect(env.ANTHROPIC_MODEL).toBe('deepseek-chat')
    expect(env.DEEPSEEK_API_KEY).toBe('sk-ds')
  })

  test('keeps the official Anthropic API-key flow', () => {
    const env: NodeJS.ProcessEnv = {
      ANTHROPIC_API_KEY: 'sk-ant',
      BASE_URL: 'https://api.anthropic.com',
    }
    normalizeProviderEnv(env)

    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com')
    expect(env.ANTHROPIC_MODEL).toBe('claude-sonnet-5-5')
  })

  test('keeps custom endpoints and applies one model to every tier', () => {
    const env: NodeJS.ProcessEnv = {
      ANTHROPIC_AUTH_TOKEN: 'custom-token',
      BASE_URL: 'https://proxy.example.com',
      MODEL: 'custom-model',
    }
    normalizeProviderEnv(env)

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('custom-token')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.example.com')
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('custom-model')
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('custom-model')
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('custom-model')
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('custom-model')
  })
})

describe('writeEnvFile', () => {
  test('writes known keys first and keeps extra keys', () => {
    const dir = makeTempDir()
    const file = join(dir, 'nested', '.env')
    writeEnvFile(file, {
      MODEL: 'deepseek-flash',
      EXTRA: 'value',
      DEEPSEEK_API_KEY: 'sk-test',
      BASE_URL: 'https://api.deepseek.com',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      ANTHROPIC_AUTH_TOKEN: 'token-test',
    })

    const text = readFileSync(file, 'utf8')
    expect(text).toContain('DEEPSEEK_API_KEY=sk-test')
    expect(text).toContain('ANTHROPIC_API_KEY=sk-ant-test')
    expect(text).toContain('ANTHROPIC_AUTH_TOKEN=token-test')
    expect(text).toContain('BASE_URL=https://api.deepseek.com')
    expect(text).toContain('MODEL=deepseek-flash')
    expect(text).toContain('EXTRA=value')
    expect(text.indexOf('MODEL=')).toBeLessThan(text.indexOf('EXTRA='))

    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600)
    }
  })
})

describe('applyLabEnvironment', () => {
  test('loads project config, then profile, then applies provider defaults', () => {
    const home = makeTempDir()
    const project = makeTempDir()
    writeFileSync(
      join(home, '.env'),
      'MODEL=home-model\nDEEPSEEK_API_KEY=sk-home\n',
    )
    writeFileSync(join(project, '.lab-agent.env'), 'MODEL=project-model\n')

    const originalCwd = process.cwd()
    process.chdir(project)
    try {
      const env: NodeJS.ProcessEnv = { LAB_AGENT_HOME: home }
      applyLabEnvironment(env)

      expect(env.MODEL).toBe('project-model')
      expect(env.LAB_AGENT_HOME).toBe(home)
      expect(env.CLAUDE_CONFIG_DIR).toBe(home)
      expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1')
      expect(env.DISABLE_TELEMETRY).toBe('1')
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-home')
      expect(env.ANTHROPIC_MODEL).toBe('project-model')
    } finally {
      process.chdir(originalCwd)
    }
  })
})

describe('maskSecret', () => {
  test('masks short and long secrets', () => {
    expect(maskSecret(undefined)).toBe('(not set)')
    expect(maskSecret('short')).toBe('*****')
    expect(maskSecret('sk-1234567890')).toBe('sk-1…7890')
  })
})
