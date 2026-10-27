import { existsSync } from 'node:fs'
import { findEngineBinary } from './engine.js'
import {
  maskSecret,
  resolveApiKey,
  resolveConfigHome,
  resolveEnvFile,
} from './home.js'

interface Check {
  name: string
  ok: boolean
  detail: string
}

function color(text: string, code: number, enabled: boolean): string {
  return enabled ? `\u001b[${code}m${text}\u001b[0m` : text
}

function normalizeEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1/messages`
}

async function checkEndpoint(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<Check> {
  const endpoint = normalizeEndpoint(baseUrl)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        authorization: `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: AbortSignal.timeout(20_000),
    })
    const body = await response.text()
    if (response.ok) {
      return { name: 'endpoint', ok: true, detail: `HTTP ${response.status} · ${endpoint}` }
    }
    if (response.status === 401 || response.status === 403) {
      return {
        name: 'endpoint',
        ok: false,
        detail: `HTTP ${response.status} · API Key 无效或无权限`,
      }
    }
    return {
      name: 'endpoint',
      ok: false,
      detail: `HTTP ${response.status} · ${body.slice(0, 160).replace(/\s+/g, ' ')}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { name: 'endpoint', ok: false, detail: `无法连接：${message}` }
  }
}

export async function runDoctor(args: string[]): Promise<number> {
  const json = args.includes('--json')
  const env = process.env
  const home = resolveConfigHome(env)
  const envFile = resolveEnvFile(env)
  const engine = findEngineBinary(env)
  const apiKey = resolveApiKey(env)
  const baseUrl = env.ANTHROPIC_BASE_URL || env.BASE_URL || '(not set)'
  const model = env.ANTHROPIC_MODEL || env.MODEL || '(not set)'

  const checks: Check[] = [
    {
      name: 'engine',
      ok: !!engine,
      detail: engine ? `${engine.path} (${engine.source})` : 'lab-engine 未找到，请先运行 bun run build',
    },
    {
      name: 'config',
      ok: existsSync(envFile) || !!apiKey,
      detail: existsSync(envFile)
        ? envFile
        : apiKey
          ? '未使用配置文件（从环境变量读取）'
          : '未配置，运行 `lab setup`',
    },
    {
      name: 'api-key',
      ok: !!apiKey,
      detail: apiKey ? maskSecret(apiKey) : '未配置，运行 `lab setup`',
    },
    {
      name: 'provider',
      ok: baseUrl !== '(not set)' && model !== '(not set)',
      detail: `${baseUrl} · ${model}`,
    },
  ]

  if (apiKey && baseUrl !== '(not set)' && model !== '(not set)') {
    checks.push(await checkEndpoint(baseUrl, apiKey, model))
  }

  const ok = checks.every((check) => check.ok)

  if (json) {
    console.log(JSON.stringify({ ok, home, envFile, checks }, null, 2))
    return ok ? 0 : 1
  }

  const useColor = !!process.stdout.isTTY && !process.env.NO_COLOR
  console.log(`${color('Lab Agent CLI', 1, useColor)} doctor`)
  console.log(`config: ${home}`)
  console.log('')
  for (const check of checks) {
    const mark = check.ok ? color('✔', 32, useColor) : color('✖', 31, useColor)
    console.log(`${mark} ${check.name.padEnd(10)} ${check.detail}`)
  }
  console.log('')
  console.log(ok ? '全部检查通过。' : '存在问题，请按上面的提示处理。')
  return ok ? 0 : 1
}
