import { banner, cleanCelebration, type VibesOptions } from '../../format/vibes.js'
import { formatFindingsRows } from '../../format/findings-list.js'
import type { DeadExportsReport } from './run.js'

export function renderDeadExportsReport(
  report: DeadExportsReport,
  options: VibesOptions = {},
): string {
  const isClean = report.findings.length === 0
  if (options.quiet && isClean && !report.hasUnresolvableDynamicImports) return ''

  const lines: string[] = []
  if (!options.quiet && !options.plain) lines.push(banner(), '')

  lines.push(`Scanned ${report.filesScanned} file${report.filesScanned === 1 ? '' : 's'}.`, '')

  if (isClean) {
    lines.push(cleanCelebration(options))
  } else {
    lines.push(
      `${report.findings.length} dead export${report.findings.length === 1 ? '' : 's'} found:`,
    )
    lines.push(
      ...formatFindingsRows(
        report.findings.map((f) => ({
          location: `${f.file}:${f.line}`,
          name: f.name,
          tag: f.isDefault ? '(default)' : f.isType ? '(type)' : '',
        })),
        options,
      ),
    )
  }

  if (report.hasUnresolvableDynamicImports) {
    lines.push(
      '',
      "Note: found a dynamic import() whose path isn't a plain string literal — it could not be resolved, so results here may include false positives.",
    )
  }

  return lines.join('\n')
}
