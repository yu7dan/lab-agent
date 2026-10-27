import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactStore } from '../src/lab/supervise/artifacts.js'
import { createRedactor } from '../src/lab/supervise/evidence.js'
import { InfraError, UsageError } from '../src/lab/supervise/errors.js'
import type { GitClient } from '../src/lab/supervise/git.js'
import { assertCleanBaseline, runSupervisor } from '../src/lab/supervise/supervisor.js'
import type { SupervisorDeps } from '../src/lab/supervise/supervisor.js'
import type {
  AcceptanceResult,
  AuditVerdict,
  EngineResult,
  EngineRunOutput,
  ResolvedContract,
  SupervisorEvent,
} from '../src/lab/supervise/types.js'

const tempDirs: string[] = []
const TASK_ID = '20260101T000000-abcdef'

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lab-agent-supervisor-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeContract(overrides: Partial<ResolvedContract> = {}): ResolvedContract {
  return {
    goal: 'fix add',
    constraints: [],
    allowedPaths: ['src'],
    acceptance: [{ name: 'tests', command: 'echo ok', timeoutSec: 10 }],
    maxRounds: 0,
    writerMode: 'bypass',
    writerTimeoutSec: 10,
    acceptTimeoutSec: 10,
    writerMaxTurns: 5,
    contractHash: 'hash',
    ...overrides,
  }
}

function engineOutput(overrides: Partial<EngineResult> = {}): EngineRunOutput {
  const parsed: EngineResult = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    permission_denials: [],
    session_id: 'writer-session',
    num_turns: 2,
    total_cost_usd: 0.01,
    ...overrides,
  }
  return {
    stdout: JSON.stringify(parsed),
    stderr: '',
    parsed,
    durationMs: 5,
  }
}

function auditorOutput(verdict: AuditVerdict): EngineRunOutput {
  return engineOutput({
    session_id: 'auditor-session',
    structured_output: verdict,
  })
}

function acceptVerdict(summary = 'looks good'): AuditVerdict {
  return { verdict: 'accept', summary, findings: [] }
}

function rejectVerdict(message = 'still broken'): AuditVerdict {
  return {
    verdict: 'reject',
    summary: message,
    findings: [
      {
        severity: 'blocking',
        message,
        evidence: 'test evidence',
        file: 'src/a.ts',
        line: 3,
      },
    ],
  }
}

function acceptanceResult(
  ok = true,
  overrides: Partial<AcceptanceResult> = {},
): AcceptanceResult {
  return {
    name: 'tests',
    command: 'echo ok',
    code: ok ? 0 : 1,
    signal: null,
    timedOut: false,
    aborted: false,
    durationMs: 10,
    stdout: ok ? 'ok' : 'failed',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    ok,
    ...overrides,
  }
}

interface FakeGitOptions {
  baselineStatus?: string
  headAfter?: string
  changed?: string[][]
  statuses?: string[]
  diff?: string
  diffStat?: string
}

function makeGit(
  root: string,
  options: FakeGitOptions = {},
): { git: GitClient; snapshots: string[] } {
  const baselineHead = 'a'.repeat(40)
  const changed = (options.changed ?? [['src/a.ts']]).map((list) => [...list])
  const statuses = [...(options.statuses ?? [])]
  const snapshots: string[] = []
  let statusIndex = 0
  let snapshotIndex = 0
  let lastStatus = ''

  const git: GitClient = {
    repoRoot: root,
    async head() {
      return options.headAfter ?? baselineHead
    },
    async status() {
      if (statusIndex < statuses.length) {
        lastStatus = statuses[statusIndex]!
        statusIndex++
      }
      return lastStatus
    },
    async baseline() {
      return {
        head: baselineHead,
        tree: 'baseline-tree',
        status: options.baselineStatus ?? '',
      }
    },
    async snapshot(_baselineTree, indexFile) {
      snapshots.push(indexFile)
      snapshotIndex++
      return {
        head: options.headAfter ?? baselineHead,
        tree: `tree-${snapshotIndex}`,
      }
    },
    async changedPaths() {
      const list =
        changed.length > 1 ? changed.shift()! : (changed[0] ?? [])
      return [...list]
    },
    async diff() {
      return options.diff ?? 'diff --git a/src/a.ts b/src/a.ts\n+fixed\n'
    },
    async diffStat() {
      return options.diffStat ?? ' src/a.ts | 1 +\n'
    },
  }

  return { git, snapshots }
}

interface HarnessOptions {
  contract: ResolvedContract
  writer: EngineRunOutput[]
  auditor: EngineRunOutput[]
  acceptance?: AcceptanceResult[][]
  git?: FakeGitOptions
  secrets?: string[]
  signal?: AbortSignal
  overrides?: Partial<SupervisorDeps>
}

function makeHarness(options: HarnessOptions) {
  const root = makeTempDir()
  const taskDir = join(root, '.lab', 'tasks', TASK_ID)
  mkdirSync(taskDir, { recursive: true })
  const redact = createRedactor(options.secrets ?? [])
  const artifacts = new ArtifactStore(taskDir, redact)
  const { git, snapshots } = makeGit(root, options.git)
  const prompts: string[] = []
  const events: SupervisorEvent[] = []
  const audits: string[] = []
  const acceptanceBatches = options.acceptance ?? [[acceptanceResult(true)]]
  let writerIndex = 0
  let auditorIndex = 0
  let acceptanceIndex = 0

  const deps: SupervisorDeps = {
    git,
    repoRoot: root,
    taskId: TASK_ID,
    artifacts,
    redact,
    signal: options.signal,
    onProgress: (event) => events.push(event),
    now: () => new Date('2026-01-01T00:00:00Z'),
    runWriter: async (prompt) => {
      prompts.push(prompt)
      const output =
        options.writer[Math.min(writerIndex, options.writer.length - 1)]!
      writerIndex++
      return output
    },
    runAuditor: async (prompt) => {
      audits.push(prompt)
      const output =
        options.auditor[Math.min(auditorIndex, options.auditor.length - 1)]!
      auditorIndex++
      return output
    },
    runAcceptance: async () => {
      const batch =
        acceptanceBatches[
          Math.min(acceptanceIndex, acceptanceBatches.length - 1)
        ]!
      acceptanceIndex++
      return batch.map((item) => ({ ...item }))
    },
    ...options.overrides,
  }

  return {
    root,
    taskDir,
    artifacts,
    git,
    snapshots,
    prompts,
    audits,
    events,
    deps,
    contract: options.contract,
  }
}

describe('runSupervisor', () => {
  test('assertCleanBaseline rejects dirty worktrees and accepts clean ones', () => {
    expect(() =>
      assertCleanBaseline({
        head: 'a'.repeat(40),
        tree: 'tree',
        status: ' M src/a.ts\0',
      }),
    ).toThrow(UsageError)
    expect(() =>
      assertCleanBaseline({
        head: 'a'.repeat(40),
        tree: 'tree',
        status: '',
      }),
    ).not.toThrow()
  })

  test('accepts on the first round and writes evidence artifacts', async () => {
    const harness = makeHarness({
      contract: makeContract(),
      writer: [engineOutput()],
      auditor: [auditorOutput(acceptVerdict())],
    })

    const report = await runSupervisor(harness.contract, harness.deps)
    expect(report.status).toBe('accepted')
    expect(report.exitCode).toBe(0)
    expect(report.rounds).toHaveLength(1)
    expect(report.rounds[0]!.finalVerdict).toBe('accept')
    expect(report.rounds[0]!.changedPaths).toEqual(['src/a.ts'])
    expect(report.rounds[0]!.writerSessionId).toBe('writer-session')
    expect(report.rounds[0]!.auditorSessionId).toBe('auditor-session')
    expect(report.rounds[0]!.artifactsDir).toBe('round-1')

    for (const file of [
      'report.json',
      'baseline.json',
      'round-1/evidence.json',
      'round-1/verdict.json',
      'round-1/diff.patch',
      'round-1/diff-stat.txt',
      'round-1/status.txt',
      'round-1/writer.json',
      'round-1/auditor.json',
      'round-1/writer-prompt.txt',
      'round-1/auditor-prompt.txt',
      'round-1/acceptance/01-tests.out.log',
      'round-1/acceptance/01-tests.err.log',
    ]) {
      expect(existsSync(join(harness.taskDir, file))).toBe(true)
    }

    const stored = JSON.parse(
      readFileSync(join(harness.taskDir, 'report.json'), 'utf8'),
    ) as { status: string; exitCode: number }
    expect(stored.status).toBe('accepted')
    expect(stored.exitCode).toBe(0)

    const verdict = JSON.parse(
      readFileSync(join(harness.taskDir, 'round-1/verdict.json'), 'utf8'),
    ) as { finalVerdict: string }
    expect(verdict.finalVerdict).toBe('accept')

    expect(harness.snapshots[0]).toContain(join('round-1', 'git-index'))
    expect(existsSync(harness.snapshots[0]!)).toBe(false)
    expect(harness.events.map((event) => event.type)).toEqual([
      'round-start',
      'writer-start',
      'writer-done',
      'acceptance-start',
      'acceptance-done',
      'auditor-start',
      'auditor-done',
      'round-done',
      'done',
    ])
  })

  test('rejects, feeds findings back, and accepts after a bounded rework', async () => {
    const harness = makeHarness({
      contract: makeContract({ maxRounds: 1 }),
      writer: [engineOutput(), engineOutput({ session_id: 'writer-2' })],
      auditor: [
        auditorOutput(rejectVerdict('the assertion still fails')),
        auditorOutput(acceptVerdict('fixed')),
      ],
      git: {
        changed: [['src/a.ts'], ['src/a.ts', 'src/b.ts']],
      },
    })

    const report = await runSupervisor(harness.contract, harness.deps)
    expect(report.status).toBe('accepted')
    expect(report.rounds).toHaveLength(2)
    expect(report.rounds[0]!.finalVerdict).toBe('reject')
    expect(report.rounds[1]!.finalVerdict).toBe('accept')
    expect(report.rounds[1]!.changedPaths).toEqual(['src/a.ts', 'src/b.ts'])
    expect(harness.prompts).toHaveLength(2)
    expect(harness.prompts[1]).toContain('the assertion still fails')
    expect(harness.prompts[1]).toContain('上一轮（round 1）')
  })

  test('rejects when the rework budget is exhausted', async () => {
    const harness = makeHarness({
      contract: makeContract({ maxRounds: 0 }),
      writer: [engineOutput()],
      auditor: [auditorOutput(rejectVerdict())],
    })

    const report = await runSupervisor(harness.contract, harness.deps)
    expect(report.status).toBe('rejected')
    expect(report.exitCode).toBe(1)
    expect(report.rounds).toHaveLength(1)
    expect(report.rounds[0]!.finalVerdict).toBe('reject')
  })

  test('returns needs_human without rework', async () => {
    const harness = makeHarness({
      contract: makeContract({ maxRounds: 3 }),
      writer: [engineOutput()],
      auditor: [
        auditorOutput({
          verdict: 'needs_human',
          summary: 'the contract is ambiguous',
          findings: [],
        }),
      ],
    })

    const report = await runSupervisor(harness.contract, harness.deps)
    expect(report.status).toBe('needs_human')
    expect(report.exitCode).toBe(4)
    expect(report.rounds).toHaveLength(1)
    expect(harness.prompts).toHaveLength(1)
  })

  test('a failed acceptance command forces reject even when the auditor accepts', async () => {
    const harness = makeHarness({
      contract: makeContract(),
      writer: [engineOutput()],
      auditor: [auditorOutput(acceptVerdict())],
      acceptance: [[acceptanceResult(false, { code: 1 })]],
    })

    const report = await runSupervisor(harness.contract, harness.deps)
    expect(report.status).toBe('rejected')
    expect(report.rounds[0]!.gate.acceptanceOk).toBe(false)
    expect(
      report.rounds[0]!.findings.some(
        (finding) =>
          finding.severity === 'blocking' &&
          finding.message.includes('验收失败'),
      ),
    ).toBe(true)
  })

  test('a path violation forces reject even when the auditor accepts', async () => {
    const harness = makeHarness({
      contract: makeContract({ allowedPaths: ['src'] }),
      writer: [engineOutput()],
      auditor: [auditorOutput(acceptVerdict())],
      git: { changed: [['tests/a.ts']] },
    })

    const report = await runSupervisor(harness.contract, harness.deps)
    expect(report.status).toBe('rejected')
    expect(report.rounds[0]!.gate.pathsOk).toBe(false)
    expect(
      report.rounds[0]!.findings.some((finding) =>
        finding.message.includes('tests/a.ts'),
      ),
    ).toBe(true)
  })

  test('a sensitive file in git status forces reject', async () => {
    const harness = makeHarness({
      contract: makeContract({ allowedPaths: ['.'] }),
      writer: [engineOutput()],
      auditor: [auditorOutput(acceptVerdict())],
      git: { changed: [[]], statuses: ['?? .env\0'] },
    })

    const report = await runSupervisor(harness.contract, harness.deps)
    expect(report.status).toBe('rejected')
    expect(report.rounds[0]!.pathViolations).toEqual([
      {
        path: '.env',
        reason: 'sensitive',
        detail: '敏感文件不允许被修改或新增',
      },
    ])
  })

  test('a HEAD change forces reject', async () => {
    const harness = makeHarness({
      contract: makeContract(),
      writer: [engineOutput()],
      auditor: [auditorOutput(acceptVerdict())],
      git: { headAfter: 'b'.repeat(40) },
    })

    const report = await runSupervisor(harness.contract, harness.deps)
    expect(report.status).toBe('rejected')
    expect(report.rounds[0]!.headChanged).toBe(true)
    expect(report.rounds[0]!.gate.headOk).toBe(false)
  })

  test('records acceptance side effects without failing the gate', async () => {
    const harness = makeHarness({
      contract: makeContract(),
      writer: [engineOutput()],
      auditor: [auditorOutput(acceptVerdict())],
      git: {
        statuses: [' M src/a.ts\0', ' M src/a.ts\0?? coverage.txt\0'],
      },
    })

    const report = await runSupervisor(harness.contract, harness.deps)
    expect(report.status).toBe('accepted')
    expect(report.rounds[0]!.acceptanceChangedWorktree).toBe(true)
    expect(report.rounds[0]!.gate.ok).toBe(true)
  })

  test('records permission denials', async () => {
    const harness = makeHarness({
      contract: makeContract(),
      writer: [
        engineOutput({
          permission_denials: [
            { tool_name: 'Bash', tool_use_id: '1' },
            { tool_name: 'Read', tool_use_id: '2' },
          ],
        }),
      ],
      auditor: [
        engineOutput({
          session_id: 'auditor-session',
          structured_output: acceptVerdict(),
          permission_denials: [{ tool_name: 'Write', tool_use_id: '3' }],
        }),
      ],
    })

    const report = await runSupervisor(harness.contract, harness.deps)
    expect(report.rounds[0]!.writerPermissionDenials).toBe(2)
    expect(report.rounds[0]!.auditorPermissionDenials).toBe(1)
  })

  test('returns infrastructure_error when the writer fails', async () => {
    const harness = makeHarness({
      contract: makeContract(),
      writer: [engineOutput()],
      auditor: [auditorOutput(acceptVerdict())],
      overrides: {
        runWriter: async () => {
          throw new InfraError('engine exploded')
        },
      },
    })

    const report = await runSupervisor(harness.contract, harness.deps)
    expect(report.status).toBe('infrastructure_error')
    expect(report.exitCode).toBe(3)
    expect(report.rounds).toHaveLength(0)
    expect(report.error).toContain('engine exploded')
  })

  test('returns infrastructure_error when the auditor verdict is malformed', async () => {
    const harness = makeHarness({
      contract: makeContract(),
      writer: [engineOutput()],
      auditor: [engineOutput({ session_id: 'auditor-session' })],
    })

    const report = await runSupervisor(harness.contract, harness.deps)
    expect(report.status).toBe('infrastructure_error')
    expect(report.exitCode).toBe(3)
    expect(report.rounds).toHaveLength(0)
  })

  test('refuses a dirty baseline', async () => {
    const harness = makeHarness({
      contract: makeContract(),
      writer: [engineOutput()],
      auditor: [auditorOutput(acceptVerdict())],
      git: { baselineStatus: ' M src/a.ts\0' },
    })

    await expect(runSupervisor(harness.contract, harness.deps)).rejects.toBeInstanceOf(
      UsageError,
    )
    expect(existsSync(join(harness.taskDir, 'report.json'))).toBe(false)
  })

  test('returns a cancelled report when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const harness = makeHarness({
      contract: makeContract(),
      writer: [engineOutput()],
      auditor: [auditorOutput(acceptVerdict())],
      signal: controller.signal,
    })

    const report = await runSupervisor(harness.contract, harness.deps)
    expect(report.status).toBe('cancelled')
    expect(report.exitCode).toBe(130)
    expect(harness.prompts).toHaveLength(0)
  })

  test('redacts secrets in prompts, diffs, and the stored report', async () => {
    const secret = 'sk-super-secret-value'
    const harness = makeHarness({
      contract: makeContract({ goal: `fix ${secret}` }),
      writer: [engineOutput()],
      auditor: [auditorOutput(acceptVerdict())],
      secrets: [secret],
      git: {
        diff: `+const key = '${secret}'\n`,
      },
    })

    const report = await runSupervisor(harness.contract, harness.deps)
    expect(harness.prompts[0]).not.toContain(secret)
    expect(harness.prompts[0]).toContain('[REDACTED]')
    expect(harness.audits[0]).not.toContain(secret)

    for (const file of [
      'round-1/writer-prompt.txt',
      'round-1/auditor-prompt.txt',
      'round-1/diff.patch',
      'report.json',
    ]) {
      const text = readFileSync(join(harness.taskDir, file), 'utf8')
      expect(text).not.toContain(secret)
    }
    const stored = JSON.parse(
      readFileSync(join(harness.taskDir, 'report.json'), 'utf8'),
    ) as { goal: string }
    expect(stored.goal).toContain('[REDACTED]')
    expect(report.goal).toContain(secret)
  })
})
