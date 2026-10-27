import { resolve } from 'node:path'
import { findEngineBinary } from '../engine.js'
import { applyLabEnvironment, resolveApiKey } from '../home.js'
import {
  buildAcceptanceEnv,
  runAcceptance as executeAcceptance,
} from './acceptance.js'
import { ArtifactStore, createTaskId, prepareTaskDirectory } from './artifacts.js'
import {
  loadContractFile,
  parseSuperviseArgs,
  resolveContract,
} from './contract.js'
import {
  buildAuditorArgs,
  buildSessionId,
  buildWriterArgs,
  runEngineCaptured,
} from './engine-run.js'
import {
  EngineNotFoundError,
  SuperviseError,
  UsageError,
} from './errors.js'
import {
  collectSecrets,
  createRedactor,
  redactDeep,
  sanitizeTerminalText,
} from './evidence.js'
import { createGitClient } from './git.js'
import { AUDITOR_SYSTEM_PROMPT, WRITER_SYSTEM_PROMPT } from './prompt.js'
import { formatHumanReport, formatJsonReport } from './report.js'
import {
  buildAuditorConfig,
  buildAuditorEnv,
  buildAuditorSettings,
  buildWriterEnv,
  buildWriterSettings,
} from './roles.js'
import {
  assertCleanBaseline,
  runSupervisor,
} from './supervisor.js'
import type {
  ParsedSuperviseArgs,
  SuperviseRunOptions,
  SupervisorEvent,
} from './types.js'

const SUPERVISE_HELP = `Lab Agent supervise — 写入者 + 独立审查者

用法:
  lab supervise "任务描述" --accept "<命令>" --allow <路径> [选项]
  lab supervise --contract <契约.json> [选项]

必填（CLI 或契约文件）:
  --accept <命令>          验收命令，可重复（最多 10 条）
  --allow <路径>           允许改动的仓库相对路径，可重复；. 表示整个仓库

选项:
  --contract <文件>        JSON 契约文件（相对当前目录）
  --constraint <文本>      额外约束，可重复
  --max-rounds <n>        初审之外的最大返工轮数（默认 2，范围 0..10）
  --writer-mode <mode>    bypass（默认）或 acceptEdits
  --timeout <秒>           单次 writer 超时（默认 1800）
  --accept-timeout <秒>    单条验收命令默认超时（默认 600）
  --max-turns <n>          writer 最大 turn 数（默认 60）
  --writer-budget-usd <n>  writer 预算上限（美元）
  --json                   stdout 只输出最终 JSON 报告
  --verbose                实时转发 writer/auditor/验收输出（已脱敏）
  --help                   显示本帮助

审查者覆盖（环境变量）:
  LAB_AUDITOR_MODEL、LAB_AUDITOR_BASE_URL、LAB_AUDITOR_API_KEY
  LAB_AUDITOR_MAX_TURNS（默认 20）、LAB_AUDITOR_TIMEOUT_SEC（默认 600）
  LAB_AUDITOR_MAX_BUDGET_USD

退出码:
  0 通过 · 1 未通过 · 2 用法/配置/git 前置条件错误
  3 基础设施错误 · 4 需要人工判断 · 127 找不到 lab-engine · 130 用户中断

工作区必须干净（忽略 .lab）。工件写入 .lab/tasks/<taskId>/。
审查者只能读取；验收命令由 supervisor 执行。writer 默认以
bypassPermissions 运行，可执行任意用户级命令，仅在可信仓库中使用。
`

function writeStderr(text: string): void {
  process.stderr.write(sanitizeTerminalText(text))
}

function failureCode(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error)
  writeStderr(`${message}\n`)
  if (error instanceof SuperviseError) return error.exitCode
  return 3
}

function describeEvent(event: SupervisorEvent, maxRounds: number): string {
  const total = maxRounds + 1
  switch (event.type) {
    case 'round-start':
      return `\n[round ${event.round}/${total}]\n`
    case 'writer-start':
      return '  writer 修改中…\n'
    case 'writer-done':
      return '  writer 完成\n'
    case 'acceptance-start':
      return '  执行验收命令…\n'
    case 'acceptance-done':
      return event.ok ? '  验收：全部通过\n' : '  验收：存在失败\n'
    case 'auditor-start':
      return '  auditor 审查中…\n'
    case 'auditor-done':
      return `  auditor 结论：${event.verdict}\n`
    case 'round-done':
      return `  round 最终结论：${event.finalVerdict}\n`
    case 'done':
      return ''
  }
}

async function execute(
  parsed: ParsedSuperviseArgs,
  invocationCwd: string,
): Promise<number> {
  const cwd = resolve(invocationCwd)
  const contractPath = parsed.contractFile
    ? resolve(cwd, parsed.contractFile)
    : null

  const git = await createGitClient(cwd)
  const repoRoot = git.repoRoot

  // Project `.lab-agent.env` is resolved from the repository root so
  // supervision behaves the same when started in a subdirectory.
  applyLabEnvironment(process.env, repoRoot)
  const env = process.env

  const fileContract = contractPath ? loadContractFile(contractPath) : null
  const contract = resolveContract(parsed, fileContract)

  const writerKey = resolveApiKey(env)
  if (!writerKey) {
    throw new UsageError(
      '未配置 writer API Key。请运行 `lab setup`，或设置 ' +
        'DEEPSEEK_API_KEY / ANTHROPIC_API_KEY。',
    )
  }

  const auditorConfig = buildAuditorConfig(env)
  const writerEnv = buildWriterEnv(env)
  const auditorEnv = buildAuditorEnv(env, auditorConfig)
  const acceptanceEnv = buildAcceptanceEnv(writerEnv)
  const redact = createRedactor(collectSecrets(env, writerEnv, auditorEnv))

  const located = findEngineBinary(env, process.execPath, cwd)
  if (!located) {
    throw new EngineNotFoundError(
      '未找到 lab-engine。请先运行 `bun run build`，' +
        '或设置 LAB_ENGINE_PATH 指向引擎二进制。',
    )
  }
  const enginePath = resolve(cwd, located.path)

  // Fail before creating a task directory so a rejected preflight leaves no
  // empty artifact folder behind.
  assertCleanBaseline(await git.baseline())

  const taskId = createTaskId()
  const paths = prepareTaskDirectory(repoRoot, taskId)
  const artifacts = new ArtifactStore(paths.taskDir, redact)
  artifacts.writeJson('contract.json', { version: 1, ...contract })
  artifacts.writeJson('settings/writer.json', buildWriterSettings())
  artifacts.writeJson('settings/auditor.json', buildAuditorSettings())
  artifacts.writeText(
    'prompts/writer-system.md',
    `${WRITER_SYSTEM_PROMPT}\n`,
  )
  artifacts.writeText(
    'prompts/auditor-system.md',
    `${AUDITOR_SYSTEM_PROMPT}\n`,
  )

  const writerSettingsPath = artifacts.pathFor('settings/writer.json')
  const auditorSettingsPath = artifacts.pathFor('settings/auditor.json')
  const writerSystemPromptPath = artifacts.pathFor('prompts/writer-system.md')
  const auditorSystemPromptPath = artifacts.pathFor('prompts/auditor-system.md')

  if (contract.writerMode === 'bypass') {
    writeStderr(
      '警告：writer 以 bypassPermissions 运行，可执行任意用户级命令。' +
        '仅在可信仓库中使用；可用 --writer-mode acceptEdits 收紧。\n',
    )
  }

  const controller = new AbortController()
  let interrupted = false
  const handleSignal = (): void => {
    if (interrupted) {
      writeStderr('\n收到第二次中断，强制退出。\n')
      process.exit(130)
    }
    interrupted = true
    writeStderr('\n收到中断信号，正在终止当前进程…\n')
    controller.abort()
  }
  process.on('SIGINT', handleSignal)
  process.on('SIGTERM', handleSignal)

  const forwardEngineStderr = parsed.verbose
    ? (chunk: string): void => writeStderr(chunk)
    : undefined
  const forwardAcceptanceOutput = parsed.verbose
    ? (_name: string, _stream: 'stdout' | 'stderr', chunk: string): void =>
        writeStderr(redact(chunk))
    : undefined

  const onProgress = (event: SupervisorEvent): void => {
    writeStderr(describeEvent(event, contract.maxRounds))
  }

  try {
    const report = await runSupervisor(contract, {
      git,
      repoRoot,
      taskId,
      artifacts,
      redact,
      signal: controller.signal,
      onProgress,
      runWriter: (prompt) =>
        runEngineCaptured({
          enginePath,
          args: buildWriterArgs({
            writerMode: contract.writerMode,
            maxTurns: contract.writerMaxTurns,
            budgetUsd: contract.writerBudgetUsd,
            sessionId: buildSessionId(),
            settingsPath: writerSettingsPath,
            systemPromptPath: writerSystemPromptPath,
          }),
          prompt,
          cwd: repoRoot,
          env: writerEnv,
          timeoutMs: contract.writerTimeoutSec * 1000,
          signal: controller.signal,
          redact,
          onStderr: forwardEngineStderr,
        }),
      runAuditor: (prompt) =>
        runEngineCaptured({
          enginePath,
          args: buildAuditorArgs({
            maxTurns: auditorConfig.maxTurns,
            budgetUsd: auditorConfig.budgetUsd,
            sessionId: buildSessionId(),
            settingsPath: auditorSettingsPath,
            systemPromptPath: auditorSystemPromptPath,
            model: auditorConfig.model,
          }),
          prompt,
          cwd: repoRoot,
          env: auditorEnv,
          timeoutMs: auditorConfig.timeoutSec * 1000,
          signal: controller.signal,
          redact,
          onStderr: forwardEngineStderr,
        }),
      runAcceptance: (commands, options) =>
        executeAcceptance(commands, {
          ...options,
          env: acceptanceEnv,
          onOutput: forwardAcceptanceOutput,
        }),
    })

    const safeReport = redactDeep(report, redact)
    if (parsed.json) {
      process.stdout.write(formatJsonReport(safeReport))
    } else {
      process.stdout.write(formatHumanReport(safeReport))
    }
    return safeReport.exitCode
  } finally {
    process.off('SIGINT', handleSignal)
    process.off('SIGTERM', handleSignal)
  }
}

/**
 * Entry point for `lab supervise`. Returns the process exit code; it never
 * throws so the CLI can keep the same error/exit-code contract as other
 * commands.
 */
export async function runSupervise(
  argv: string[],
  options: SuperviseRunOptions = { cwd: process.cwd() },
): Promise<number> {
  let parsed: ParsedSuperviseArgs
  try {
    parsed = parseSuperviseArgs(argv)
  } catch (error) {
    return failureCode(error)
  }

  if (parsed.help) {
    process.stdout.write(SUPERVISE_HELP)
    return 0
  }

  try {
    return await execute(parsed, options.cwd)
  } catch (error) {
    return failureCode(error)
  }
}
