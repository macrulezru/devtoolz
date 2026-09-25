import { banner, cleanCelebration, type VibesOptions } from '../../format/vibes.js'
import { formatFindingsRows } from '../../format/findings-list.js'
import { renderDiffForHumans } from '../../format/diff-render.js'
import type { CaseCheckReport } from './run.js'

export function renderCaseCheckReport(report: CaseCheckReport, options: VibesOptions = {}): string {
  const isClean = report.findings.length === 0
  if (options.quiet && isClean) return ''

  const lines: string[] = []
  if (!options.quiet && !options.plain) lines.push(banner(), '')

  lines.push(`Scanned ${report.filesScanned} file${report.filesScanned === 1 ? '' : 's'}.`, '')

  if (isClean) {
    lines.push(cleanCelebration(options))
    return lines.join('\n')
  }

  lines.push(
    `${report.findings.length} case mismatch${report.findings.length === 1 ? '' : 'es'} found:`,
  )
  lines.push(
    ...formatFindingsRows(
      report.findings.map((f) => ({
        location: `${f.file}:${f.line}:${f.column}`,
        name: `${f.specifier} → ${f.correctedSpecifier}`,
        tag: f.isAlias ? '(alias, not auto-fixed)' : '',
      })),
      options,
    ),
  )

  if (report.changes.length > 0) {
    lines.push(
      '',
      report.applied
        ? `Fixed ${report.changes.reduce((n, c) => n + c.count, 0)} import(s) in ${report.changes.length} file(s).`
        : `Would fix ${report.changes.reduce((n, c) => n + c.count, 0)} import(s) in ${report.changes.length} file(s) — pass -y to apply.`,
    )
    for (const change of report.changes) {
      if (!change.diff) continue
      const unit = `import${change.count === 1 ? '' : 's'}`
      lines.push('', renderDiffForHumans(change.file, change.count, unit, change.diff, options))
    }
  } else if (report.findings.some((f) => !f.isAlias)) {
    lines.push('', '(pass --fix -y to apply, or --fix --diff to preview the fix)')
  }

  return lines.join('\n')
}
