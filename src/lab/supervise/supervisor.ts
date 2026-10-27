import type { AcceptanceRunOptions } from './acceptance.js'
import type { ArtifactStore } from './artifacts.js'
import { CancelledError, SuperviseError, UsageError } from './errors.js'
import {
  analyzeChanges,
  toAcceptanceSummary,
  truncateText,
} from './evidence.js'
import type { Redactor } from './evidence.js'
import { parsePorcelainZ } from './git.js'
import type { GitBaseline, GitClient } from './git.js'
import { buildAuditorPrompt, buildWriterPrompt } from './prompt.js'
import { exitCodeForStatus } from './report.js'
import type {
  AcceptanceCommand,
  AcceptanceResult,
  EngineRunOutput,
  PreviousReview,
  ReportStatus,
  ResolvedContract,
  RoundRecord,
  SuperviseReport,
  SupervisorEvent,
} from './types.js'
import { evaluateGate, normalizeDecision, parseVerdict } from './verdict.js'

const MAX_DIFF_ARTIFACT_CHARS = 8 * 1024 * 1024

export interface SupervisorDeps {
  git: GitClient
  runWriter: (prompt: string, round: number) => Promise<EngineRunOutput>
  runAuditor: (prompt: string, round: number) => Promise<EngineRunOutput>
  runAcceptance: (
    commands: AcceptanceCommand[],
    options: AcceptanceRunOptions,
  ) => Promise<AcceptanceResult[]>
  artifacts: ArtifactStore
  repoRoot: string
  taskId: string
  redact: Redactor
  maxChangedPaths?: number
  signal?: AbortSignal
  onProgress?: (event: SupervisorEvent) => void
  now?: () => Date
  startedAt?: Date
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Reject a dirty or empty baseline before any artifacts are created. */
export function assertCleanBaseline(baseline: GitBaseline): void {
  const dirty = parsePorcelainZ(baseline.status)
  if (dirty.length === 0) return
  const preview = dirty
    .slice(0, 10)
    .map((entry) => `${entry.status} ${entry.path}`)
    .join('\n')
  throw new UsageError(
    '工作区不干净（排除 .lab 后仍有改动）。请先 commit 或 stash 后重试。' +
      (preview ? `\n${preview}` : ''),
  )
}

/**
 * Core supervision loop. All process, git, and artifact interactions are
 * injected so the orchestration can be tested without network or API calls.
 */
export async function runSupervisor(
  contract: ResolvedContract,
  deps: SupervisorDeps,
): Promise<SuperviseReport> {
  const clock = deps.now ?? (() => new Date())
  const startedAt = deps.startedAt ?? clock()
  const rounds: RoundRecord[] = []
  const maxChangedPaths = deps.maxChangedPaths ?? 500

  const finish = async (
    status: ReportStatus,
    error?: string,
  ): Promise<SuperviseReport> => {
    const report: SuperviseReport = {
      schemaVersion: 1,
      status,
      exitCode: exitCodeForStatus(status),
      taskId: deps.taskId,
      repoRoot: deps.repoRoot,
      goal: contract.goal,
      contractHash: contract.contractHash,
      rounds,
      artifactsDir: deps.artifacts.taskDir,
      startedAt: startedAt.toISOString(),
      finishedAt: clock().toISOString(),
      ...(error ? { error: deps.redact(error) } : {}),
    }
    await deps.artifacts.writeJson('report.json', report)
    deps.onProgress?.({ type: 'done', status })
    return report
  }

  try {
    const baseline = await deps.git.baseline()
    assertCleanBaseline(baseline)
    await deps.artifacts.writeJson('baseline.json', baseline)

    let previousReview: PreviousReview | undefined

    for (let round = 1; round <= contract.maxRounds + 1; round++) {
      if (deps.signal?.aborted) throw new CancelledError()
      deps.onProgress?.({ type: 'round-start', round })

      const writerPrompt = deps.redact(
        buildWriterPrompt(contract, round, previousReview),
      )
      await deps.artifacts.writeText(
        `round-${round}/writer-prompt.txt`,
        writerPrompt,
      )

      deps.onProgress?.({ type: 'writer-start', round })
      const writer = await deps.runWriter(writerPrompt, round)
      await deps.artifacts.writeText(`round-${round}/writer.json`, writer.stdout)
      await deps.artifacts.writeText(
        `round-${round}/writer.stderr.log`,
        writer.stderr,
      )
      deps.onProgress?.({
        type: 'writer-done',
        round,
        sessionId: writer.parsed.session_id,
      })

      const headAfter = await deps.git.head()
      const headChanged = headAfter !== baseline.head
      const indexFile = deps.artifacts.pathFor(`round-${round}/git-index`)
      const snapshot = await deps.git.snapshot(baseline.tree, indexFile)
      const changedPaths = await deps.git.changedPaths(
        baseline.tree,
        snapshot.tree,
      )
      const diff = await deps.git.diff(baseline.tree, snapshot.tree)
      const diffStat = await deps.git.diffStat(baseline.tree, snapshot.tree)
      const statusAfterWriter = await deps.git.status()

      const diffForArtifact = truncateText(diff, MAX_DIFF_ARTIFACT_CHARS)
      await deps.artifacts.writeText(
        `round-${round}/diff.patch`,
        diffForArtifact.text,
      )
      await deps.artifacts.writeText(
        `round-${round}/diff-stat.txt`,
        diffStat,
      )
      await deps.artifacts.writeText(
        `round-${round}/status.txt`,
        statusAfterWriter,
      )

      const analysis = analyzeChanges({
        repoRoot: deps.repoRoot,
        changedPaths,
        statusEntries: parsePorcelainZ(statusAfterWriter),
        allowedPaths: contract.allowedPaths,
        maxChangedPaths,
      })

      deps.onProgress?.({ type: 'acceptance-start', round })
      const acceptance = await deps.runAcceptance(contract.acceptance, {
        cwd: deps.repoRoot,
        signal: deps.signal,
      })
      for (const [index, result] of acceptance.entries()) {
        const filename = `${String(index + 1).padStart(2, '0')}-${
          slugify(result.name) || 'cmd'
        }`
        await deps.artifacts.writeText(
          `round-${round}/acceptance/${filename}.out.log`,
          result.stdout,
        )
        await deps.artifacts.writeText(
          `round-${round}/acceptance/${filename}.err.log`,
          result.stderr,
        )
      }
      deps.onProgress?.({
        type: 'acceptance-done',
        round,
        ok: acceptance.every((result) => result.ok),
      })

      const statusAfterAcceptance = await deps.git.status()
      const acceptanceChangedWorktree =
        statusAfterAcceptance !== statusAfterWriter
      const gate = evaluateGate({
        acceptance,
        pathViolations: analysis.pathViolations,
        headChanged,
        changedPathCount: analysis.changedPaths.length,
        maxChangedPaths,
      })

      await deps.artifacts.writeJson(`round-${round}/evidence.json`, {
        round,
        changedPaths: analysis.changedPaths,
        pathViolations: analysis.pathViolations,
        sensitivePaths: analysis.sensitivePaths,
        gate,
        headChanged,
        acceptanceChangedWorktree,
        acceptance: acceptance.map(toAcceptanceSummary),
        diffStat: truncateText(diffStat, 20_000).text,
        statusAfterWriter: parsePorcelainZ(statusAfterWriter),
      })

      const auditorPrompt = deps.redact(
        buildAuditorPrompt({
          contract,
          round,
          changedPaths: analysis.changedPaths,
          pathViolations: analysis.pathViolations,
          acceptance: acceptance.map((result) => ({
            ...result,
            stdout: deps.redact(result.stdout),
            stderr: deps.redact(result.stderr),
          })),
          diff: deps.redact(diff),
          diffStat: deps.redact(diffStat),
          headChanged,
          acceptanceChangedWorktree,
          maxChangedPaths,
        }),
      )
      await deps.artifacts.writeText(
        `round-${round}/auditor-prompt.txt`,
        auditorPrompt,
      )

      deps.onProgress?.({ type: 'auditor-start', round })
      const auditor = await deps.runAuditor(auditorPrompt, round)
      await deps.artifacts.writeText(
        `round-${round}/auditor.json`,
        auditor.stdout,
      )
      await deps.artifacts.writeText(
        `round-${round}/auditor.stderr.log`,
        auditor.stderr,
      )
      const verdict = parseVerdict(auditor.parsed.structured_output)
      deps.onProgress?.({
        type: 'auditor-done',
        round,
        verdict: verdict.verdict,
      })

      const decision = normalizeDecision(verdict, gate)
      const record: RoundRecord = {
        round,
        changedPaths: analysis.changedPaths,
        pathViolations: analysis.pathViolations,
        acceptance: acceptance.map(toAcceptanceSummary),
        acceptanceChangedWorktree,
        headChanged,
        gate,
        verdict,
        finalVerdict: decision.finalVerdict,
        findings: decision.findings,
        writerSessionId: writer.parsed.session_id,
        auditorSessionId: auditor.parsed.session_id,
        writerCostUsd: writer.parsed.total_cost_usd,
        auditorCostUsd: auditor.parsed.total_cost_usd,
        writerTurns: writer.parsed.num_turns,
        auditorTurns: auditor.parsed.num_turns,
        writerPermissionDenials: writer.parsed.permission_denials.length,
        auditorPermissionDenials: auditor.parsed.permission_denials.length,
        artifactsDir: `round-${round}`,
      }

      await deps.artifacts.writeJson(`round-${round}/verdict.json`, {
        auditor: verdict,
        finalVerdict: decision.finalVerdict,
        gate,
        findings: decision.findings,
        acceptanceChangedWorktree,
        writerPermissionDenials: record.writerPermissionDenials,
        auditorPermissionDenials: record.auditorPermissionDenials,
      })

      rounds.push(record)
      deps.onProgress?.({
        type: 'round-done',
        round,
        finalVerdict: decision.finalVerdict,
      })

      if (decision.finalVerdict === 'accept') {
        return await finish('accepted')
      }
      if (decision.finalVerdict === 'needs_human') {
        return await finish('needs_human')
      }
      if (round >= contract.maxRounds + 1) {
        return await finish('rejected')
      }

      previousReview = {
        round,
        finalVerdict: decision.finalVerdict,
        summary: verdict.summary,
        findings: decision.findings,
        gateReasons: gate.reasons,
      }
    }

    return await finish('rejected')
  } catch (error) {
    if (error instanceof UsageError) throw error
    if (error instanceof CancelledError) {
      return await finish('cancelled', error.message)
    }
    if (error instanceof SuperviseError) {
      return await finish('infrastructure_error', error.message)
    }
    return await finish('infrastructure_error', errorMessage(error))
  }
}
