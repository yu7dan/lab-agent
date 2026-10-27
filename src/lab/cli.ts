import { createInterface } from 'node:readline/promises'
import { runDoctor } from './doctor.js'
import { findEngineBinary, runEngine } from './engine.js'
import {
  applyLabEnvironment,
  maskSecret,
  resolveApiKey,
  resolveConfigHome,
  resolveEnvFile,
} from './home.js'
import { runSetup } from './setup.js'

function readVersion(): string {
  try {
    // Replaced at build time with `bun build --define`.
    return MACRO.VERSION
  } catch {
    return '0.3.0-dev'
  }
}

const VERSION = readVersion()

const HELP = `Lab Agent CLI ${VERSION}

用法:
  lab                    启动交互式 coding agent
  lab "任务描述"          带着初始任务启动
  lab -p "任务描述"        一次性执行（headless）
  lab setup              配置模型提供方与 API Key
  lab doctor             检查配置、引擎与网络连接
  lab config [path]      查看配置（path 只输出配置文件路径）
  lab engine [args]      直接调用 lab-engine
  lab version            显示版本
  lab help               显示帮助

配置目录: ~/.lab-agent（可用 LAB_AGENT_HOME 覆盖）
引擎参数会原样传给 lab-engine，例如:
  lab --resume
  lab --model deepseek-flash
`

function printHelp(): void {
  console.log(HELP)
}

function printConfig(): void {
  const env = process.env
  const home = resolveConfigHome(env)
  const envFile = resolveEnvFile(env)
  const engine = findEngineBinary(env)
  console.log(`home:     ${home}`)
  console.log(`env file: ${envFile}`)
  console.log(`api key:  ${maskSecret(resolveApiKey(env))}`)
  console.log(`base url: ${env.ANTHROPIC_BASE_URL || env.BASE_URL || '(not set)'}`)
  console.log(`model:    ${env.ANTHROPIC_MODEL || env.MODEL || '(not set)'}`)
  console.log(`engine:   ${engine ? engine.path : '(not found)'}`)
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(question)).trim().toLowerCase()
    return answer === '' || answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}

async function ensureConfigured(): Promise<boolean> {
  applyLabEnvironment()
  if (resolveApiKey()) return true

  if (!process.stdin.isTTY) {
    console.error(
      '未配置 API Key。请运行 `lab setup`，或设置 DEEPSEEK_API_KEY / ANTHROPIC_AUTH_TOKEN。',
    )
    return false
  }

  const shouldSetup = await confirm('未检测到 API Key，现在运行 `lab setup`？[Y/n] ')
  if (!shouldSetup) return false
  const code = await runSetup([])
  if (code !== 0) return false
  applyLabEnvironment()
  return !!resolveApiKey()
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (command === 'version' || command === '--version' || command === '-v' || command === '-V') {
    console.log(`Lab Agent CLI ${VERSION}`)
    return 0
  }
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return 0
  }
  if (command === 'setup') {
    return runSetup(args.slice(1))
  }
  if (command === 'doctor') {
    applyLabEnvironment()
    return runDoctor(args.slice(1))
  }
  if (command === 'config') {
    applyLabEnvironment()
    if (args[1] === 'path') {
      console.log(resolveEnvFile())
    } else {
      printConfig()
    }
    return 0
  }
  if (command === 'engine') {
    applyLabEnvironment()
    return runEngine(args.slice(1))
  }

  // Default: launch the interactive engine. All arguments pass through.
  if (!(await ensureConfigured())) return 1
  const engine = findEngineBinary()
  if (!engine) {
    console.error(
      '未找到 lab-engine。请先运行 `bun run build`，或设置 LAB_ENGINE_PATH。',
    )
    return 127
  }
  return runEngine(args)
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
