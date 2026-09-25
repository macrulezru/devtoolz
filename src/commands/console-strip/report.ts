import { banner, cleanCelebration, type VibesOptions } from '../../format/vibes.js'
import { formatFileCountRows } from '../../format/file-list.js'
import { renderDiffForHumans } from '../../format/diff-render.js'
import type { ConsoleStripReport } from './run.js'

const REASON_LABEL: Record<string, string> = {
  'embedded-in-expression': 'part of a larger expression, not its own statement',
  'braceless-body': 'inside a single-statement body without braces',
}

export function renderConsoleStripReport(
  report: ConsoleStripReport,
  options: VibesOptions = {},
): string {
  const isClean = report.changes.length === 0 && report.skipped.length === 0
  if (options.quiet && isClean) return ''

  const lines: string[] = []
  if (!options.quiet && !options.plain) lines.push(banner(), '')

  lines.push(`Scanned ${report.filesScanned} file${report.filesScanned === 1 ? '' : 's'}.`, '')

  if (isClean) {
    lines.push(cleanCelebration(options))
    return lines.join('\n')
  }

  if (report.changes.length > 0) {
    const verb = report.applied
      ? 'Stripped console/debugger statements in'
      : 'Would strip console/debugger statements in'
    lines.push(`${verb} ${report.changes.length} file(s):`)
    lines.push(
      ...formatFileCountRows(report.changes, (n) => `statement${n === 1 ? '' : 's'}`, options),
    )
    if (!report.applied) {
      const diffHint = report.changes.some((c) => c.diff) ? '' : ', or --diff to see exactly what'
      lines.push(
        '',
        `(nothing written — pass -y to apply${diffHint}, or --dry-run to keep previewing)`,
      )
    }
    for (const change of report.changes) {
      if (!change.diff) continue
      const unit = `statement${change.count === 1 ? '' : 's'}`
      lines.push('', renderDiffForHumans(change.file, change.count, unit, change.diff, options))
    }
  }

  if (report.skipped.length > 0) {
    if (report.changes.length > 0) lines.push('')
    lines.push(`${report.skipped.length} left in place, needs a manual look:`)
    for (const s of report.skipped) {
      lines.push(
        `  - ${s.file}:${s.line}:${s.column} — ${REASON_LABEL[s.reason] ?? s.reason} — ${s.snippet}`,
      )
    }
  }

  return lines.join('\n')
}
