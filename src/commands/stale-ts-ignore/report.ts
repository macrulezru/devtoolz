import { banner, cleanCelebration, type VibesOptions } from '../../format/vibes.js'
import { formatFindingsRows } from '../../format/findings-list.js'
import type { StaleTsIgnoreReport } from './run.js'

export function renderStaleTsIgnoreReport(
  report: StaleTsIgnoreReport,
  options: VibesOptions = {},
): string {
  if (report.error) {
    const lines: string[] = []
    if (!options.quiet && !options.plain) lines.push(banner(), '')
    lines.push(`Could not run stale-ts-ignore: ${report.error}`)
    return lines.join('\n')
  }

  const isClean = report.findings.length === 0
  if (options.quiet && isClean) return ''

  const lines: string[] = []
  if (!options.quiet && !options.plain) lines.push(banner(), '')

  lines.push(
    `Checked ${report.directivesChecked} @ts-ignore directive${report.directivesChecked === 1 ? '' : 's'}.`,
    '',
  )

  if (isClean) {
    lines.push(cleanCelebration(options))
    return lines.join('\n')
  }

  lines.push(
    `${report.findings.length} stale @ts-ignore${report.findings.length === 1 ? '' : 's'} found:`,
  )
  lines.push(
    ...formatFindingsRows(
      report.findings.map((f) => ({
        location: `${f.file}:${f.line}`,
        name: '@ts-ignore',
        tag: "doesn't suppress anything — the line below it typechecks cleanly without it",
      })),
      options,
    ),
  )

  return lines.join('\n')
}
