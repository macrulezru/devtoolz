import { banner, cleanCelebration, type VibesOptions } from '../../format/vibes.js'
import { formatFileCountRows } from '../../format/file-list.js'
import { renderDiffForHumans } from '../../format/diff-render.js'
import type { StripCommentsReport } from './run.js'

export interface RenderOptions extends VibesOptions {
  dryRun?: boolean
}

export function renderStripCommentsReport(
  report: StripCommentsReport,
  options: RenderOptions = {},
): string {
  if (options.quiet && report.changes.length === 0) return ''

  const lines: string[] = []
  if (!options.quiet && !options.plain) lines.push(banner(), '')

  lines.push(`Scanned ${report.filesScanned} file${report.filesScanned === 1 ? '' : 's'}.`, '')

  if (report.changes.length === 0) {
    lines.push(cleanCelebration(options))
    return lines.join('\n')
  }

  const verb = report.applied ? 'Stripped comments in' : 'Would strip comments in'
  lines.push(`${verb} ${report.changes.length} file(s):`)
  lines.push(...formatFileCountRows(report.changes, (n) => `comment${n === 1 ? '' : 's'}`, options))

  if (!report.applied) {
    const diffHint = report.changes.some((c) => c.diff) ? '' : ', or --diff to see exactly what'
    lines.push(
      '',
      `(nothing written — pass -y to apply${diffHint}, or --dry-run to keep previewing)`,
    )
  }

  for (const change of report.changes) {
    if (!change.diff) continue
    const unit = `comment${change.count === 1 ? '' : 's'}`
    lines.push('', renderDiffForHumans(change.file, change.count, unit, change.diff, options))
  }

  return lines.join('\n')
}
