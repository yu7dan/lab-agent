import { existsSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import {
  ensureConfigHome,
  isRealApiKey,
  maskSecret,
  parseEnvFile,
  writeEnvFile,
} from './home.js'

type ProviderId = 'deepseek' | 'anthropic' | 'custom'

type KeyName = 'DEEPSEEK_API_KEY' | 'ANTHROPIC_API_KEY' | 'ANTHROPIC_AUTH_TOKEN'

interface ProviderPreset {
  id: ProviderId
  label: string
  baseUrl: string
  model: string
  keyName: KeyName
}

const PRESETS: Record<ProviderId, ProviderPreset> = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    keyName: 'DEEPSEEK_API_KEY',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: '',
    keyName: 'ANTHROPIC_API_KEY',
  },
  custom: {
    id: 'custom',
    label: 'Custom Anthropic-compatible endpoint',
    baseUrl: '',
    model: '',
    keyName: 'ANTHROPIC_AUTH_TOKEN',
  },
}

interface SetupFlags {
  provider?: ProviderId
  apiKey?: string
  baseUrl?: string
  model?: string
  yes: boolean
}

function parseFlags(args: string[]): SetupFlags {
  const flags: SetupFlags = { yes: false }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    const next = () => args[++i]
    if (arg === '--provider') {
      const value = next()
      if (value === 'deepseek' || value === 'anthropic' || value === 'custom') {
        flags.provider = value
      }
    } else if (arg.startsWith('--provider=')) {
      const value = arg.slice('--provider='.length)
      if (value === 'deepseek' || value === 'anthropic' || value === 'custom') {
        flags.provider = value
      }
    } else if (arg === '--api-key') {
      flags.apiKey = next()
    } else if (arg.startsWith('--api-key=')) {
      flags.apiKey = arg.slice('--api-key='.length)
    } else if (arg === '--base-url') {
      flags.baseUrl = next()
    } else if (arg.startsWith('--base-url=')) {
      flags.baseUrl = arg.slice('--base-url='.length)
    } else if (arg === '--model') {
      flags.model = next()
    } else if (arg.startsWith('--model=')) {
      flags.model = arg.slice('--model='.length)
    } else if (arg === '--yes' || arg === '-y') {
      flags.yes = true
    }
  }
  return flags
}

async function promptVisible(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

async function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin
  const stdout = process.stdout
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return promptVisible(question)
  }

  return new Promise((resolve) => {
    stdout.write(question)
    const wasRaw = stdin.isRaw
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let value = ''

    const cleanup = () => {
      stdin.setRawMode(wasRaw)
      stdin.pause()
      stdin.removeListener('data', onData)
    }
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          cleanup()
          stdout.write('\n')
          resolve(value)
          return
        }
        if (char === '\u0003') {
          cleanup()
          stdout.write('\n')
          process.exit(130)
        }
        if (char === '\u007f' || char === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1)
            stdout.write('\b \b')
          }
          continue
        }
        if (char >= ' ') {
          value += char
          stdout.write('*')
        }
      }
    }
    stdin.on('data', onData)
  })
}

function selectProvider(value: string): ProviderId | undefined {
  const normalized = value.trim().toLowerCase()
  if (normalized === '1' || normalized === 'deepseek') return 'deepseek'
  if (normalized === '2' || normalized === 'anthropic') return 'anthropic'
  if (normalized === '3' || normalized === 'custom') return 'custom'
  return undefined
}

export async function runSetup(args: string[]): Promise<number> {
  const flags = parseFlags(args)
  const { home, envFile } = ensureConfigHome()
  const existing = existsSync(envFile)
    ? parseEnvFile(readFileSync(envFile, 'utf8'))
    : {}
  const existingKey =
    existing.DEEPSEEK_API_KEY ||
    existing.ANTHROPIC_API_KEY ||
    existing.ANTHROPIC_AUTH_TOKEN
  const interactive = !!process.stdin.isTTY && !flags.yes

  if (!flags.yes && !process.stdin.isTTY) {
    console.error('非交互环境请使用：lab setup --provider deepseek --api-key <key> --yes')
    return 1
  }

  let provider: ProviderId = flags.provider ?? 'deepseek'
  if (!flags.provider && interactive) {
    const answer = await promptVisible(
      '选择模型提供方：[1] DeepSeek  [2] Anthropic  [3] 自定义 Anthropic 兼容端点（默认 1）: ',
    )
    provider = selectProvider(answer || '1') ?? 'deepseek'
  }
  const preset = PRESETS[provider]

  let apiKey = flags.apiKey?.trim() ?? ''
  if (!apiKey && interactive) {
    const hint = existingKey ? `（回车保留当前 ${maskSecret(existingKey)}）` : ''
    apiKey = await promptHidden(`API Key${hint}: `)
    if (!apiKey && existingKey) apiKey = existingKey
  }
  if (!apiKey && existingKey) apiKey = existingKey
  if (!isRealApiKey(apiKey)) {
    console.error('未提供有效的 API Key。')
    return 1
  }

  let baseUrl = flags.baseUrl?.trim() ?? ''
  if (!baseUrl && interactive) {
    const answer = await promptVisible(
      `Base URL（默认 ${preset.baseUrl || '必填'}）: `,
    )
    baseUrl = answer || preset.baseUrl
  }
  baseUrl = baseUrl || preset.baseUrl
  if (!baseUrl) {
    console.error('自定义端点必须提供 --base-url。')
    return 1
  }

  let model = flags.model?.trim() ?? ''
  if (!model && interactive) {
    const answer = await promptVisible(
      `模型（默认 ${preset.model || '必填'}）: `,
    )
    model = answer || preset.model
  }
  model = model || preset.model
  if (!model) {
    console.error('该提供方必须提供 --model。')
    return 1
  }

  const values: Record<string, string> = { ...existing }
  delete values.DEEPSEEK_API_KEY
  delete values.ANTHROPIC_API_KEY
  delete values.ANTHROPIC_AUTH_TOKEN
  values[preset.keyName] = apiKey
  values.BASE_URL = baseUrl
  values.MODEL = model
  writeEnvFile(envFile, values)

  console.log('')
  console.log(`已保存配置：${envFile}`)
  console.log(`提供方：${preset.label}`)
  console.log(`Base URL：${baseUrl}`)
  console.log(`模型：${model}`)
  console.log(`API Key：${maskSecret(apiKey)}`)
  console.log('')
  console.log('下一步：运行 `lab doctor` 检查连接，然后运行 `lab` 开始。')
  return 0
}
