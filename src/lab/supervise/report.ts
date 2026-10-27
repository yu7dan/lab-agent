import { sanitizeTerminalText, truncateText } from './evidence.js'
import type { Finding, ReportStatus, SuperviseReport } from './types.js'

export function exitCodeForStatus(status: ReportStatus): number {
  switch (status) {
    case 'accepted':
      return 0
    case 'rejected':
      return 1
    case 'needs_human':
      return 4
    case 'infrastructure_error':
      return 3
    case 'cancelled':
      return 130
  }
}

const STATUS_TEXT: Record<ReportStatus, string> = {
  accepted: '通过（accepted）',
  rejected: '未通过（rejected）',
  needs_human: '需要人工判断（needs_human）',
  infrastructure_error: '基础设施错误（infrastructure_error）',
  cancelled: '已取消（cancelled）',
}

function oneLine(text: string, maxChars: number): string {
  const safe = sanitizeTerminalText(text).replace(/\s+/g, ' ').trim()
  return truncateText(safe, maxChars).text
}

function formatFinding(finding: Finding): string {
  const location = finding.file
    ? `${finding.file}${finding.line ? `:${finding.line}` : ''}`
    : finding.command
      ? `command: ${oneLine(finding.command, 120)}`
      : 'no citation'
  const evidence = oneLine(finding.evidence, 300)
  return [
    `  - [${finding.severity}] ${location} — ${oneLine(finding.message, 500)}`,
    `    evidence: ${evidence}`,
  ].join('\n')
}

export function formatHumanReport(report: SuperviseReport): string {
  const lines: string[] = []
  lines.push(`Lab Agent supervise — ${STATUS_TEXT[report.status]}`)
  lines.push(`task: ${report.taskId}`)
  lines.push(`goal: ${oneLine(report.goal, 300)}`)
  lines.push(`repo: ${report.repoRoot}`)
  lines.push(`rounds: ${report.rounds.length}`)
  lines.push('')

  if (report.rounds.length === 0) {
    lines.push('（没有完成任何审查轮次）')
  }

  for (const round of report.rounds) {
    const acceptancePassed = round.acceptance.filter((item) => item.ok).length
    lines.push(
      `round ${round.round}: ${round.finalVerdict} — ${oneLine(round.verdict.summary, 400)}`,
    )
    lines.push(
      `  验收: ${acceptancePassed}/${round.acceptance.length} 通过 · 改动 ${round.changedPaths.length} 个文件`,
    )
    if (round.writerPermissionDenials) {
      lines.push(
        `  warning: writer 有 ${round.writerPermissionDenials} 次工具调用被权限拒绝`,
      )
    }
    if (round.auditorPermissionDenials) {
      lines.push(
        `  warning: auditor 有 ${round.auditorPermissionDenials} 次工具调用被权限拒绝`,
      )
    }
    if (round.gate.reasons.length > 0) {
      for (const reason of round.gate.reasons.slice(0, 5)) {
        lines.push(`  gate: ${oneLine(reason, 400)}`)
      }
      if (round.gate.reasons.length > 5) {
        lines.push(`  gate: … 还有 ${round.gate.reasons.length - 5} 条`)
      }
    }

    const visibleFindings = round.findings.filter(
      (finding) => finding.severity !== 'info',
    )
    for (const finding of visibleFindings.slice(0, 5)) {
      lines.push(formatFinding(finding))
    }
    if (visibleFindings.length > 5) {
      lines.push(`  … 还有 ${visibleFindings.length - 5} 条 findings`)
    }
    lines.push('')
  }

  if (report.error) {
    lines.push(`error: ${oneLine(report.error, 2000)}`)
    lines.push('')
  }

  lines.push(`artifacts: ${report.artifactsDir}`)
  return sanitizeTerminalText(`${lines.join('\n')}\n`)
}

export function formatJsonReport(report: SuperviseReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}
