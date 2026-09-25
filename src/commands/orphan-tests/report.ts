import { banner, cleanCelebration, type VibesOptions } from '../../format/vibes.js'
import { formatFindingsRows } from '../../format/findings-list.js'
import type { OrphanTestsReport } from './run.js'

export function renderOrphanTestsReport(
  report: OrphanTestsReport,
  options: VibesOptions = {},
): string {
  if (report.error) {
    const lines: string[] = []
    if (!options.quiet && !options.plain) lines.push(banner(), '')
    lines.push(`Could not run orphan-tests: ${report.error}`)
    return lines.join('\n')
  }

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
    `${report.findings.length} orphan test${report.findings.length === 1 ? '' : 's'} found:`,
  )
  lines.push(
    ...formatFindingsRows(
      report.findings.map((f) => ({
        location: f.file,
        name: 'orphan',
        tag: `no matching source found (tried ${f.triedExtensions.join(', ')})`,
      })),
      options,
    ),
  )

  return lines.join('\n')
}
