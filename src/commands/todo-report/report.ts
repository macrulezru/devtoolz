import { banner, cleanCelebration, type VibesOptions } from '../../format/vibes.js'
import { formatFindingsRows } from '../../format/findings-list.js'
import type { TodoReportReport } from './run.js'

export function renderTodoReportReport(
  report: TodoReportReport,
  options: VibesOptions = {},
): string {
  const isClean = report.findings.length === 0
  if (options.quiet && isClean) return ''

  const lines: string[] = []
  if (!options.quiet && !options.plain) lines.push(banner(), '')

  lines.push(`Scanned ${report.filesScanned} file${report.filesScanned === 1 ? '' : 's'}.`, '')

  if (isClean) {
    lines.push(cleanCelebration(options))
    return lines.join('\n')
  }

  const tagSummary = Object.entries(report.countsByTag)
    .map(([tag, count]) => `${tag}: ${count}`)
    .join(', ')
  lines.push(
    `${report.findings.length} comment${report.findings.length === 1 ? '' : 's'} found (${tagSummary}):`,
  )
  lines.push(
    ...formatFindingsRows(
      report.findings.map((f) => ({
        location: `${f.file}:${f.line}:${f.column}`,
        name: f.tag,
        tag: f.text,
      })),
      options,
    ),
  )

  if (report.max > 0) {
    lines.push(
      '',
      report.exitCode === 0
        ? `Within the configured limit (--max ${report.max}).`
        : `Over the configured limit (--max ${report.max}).`,
    )
  }

  return lines.join('\n')
}
