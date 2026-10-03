import { banner, cleanCelebration, type VibesOptions } from '../../format/vibes.js'
import { formatFindingsRows } from '../../format/findings-list.js'
import { createStyle } from '../../format/style.js'
import type { UnusedDepsReport } from './run.js'

export function renderUnusedDepsReport(
  report: UnusedDepsReport,
  options: VibesOptions = {},
): string {
  const s = createStyle(options)
  if (report.error) {
    const lines: string[] = []
    if (!options.quiet && !options.plain) lines.push(banner(options), '')
    lines.push(s.error(`Could not run unused-deps: ${report.error}`))
    return lines.join('\n')
  }

  const isClean = report.findings.length === 0
  if (options.quiet && isClean) return ''

  const lines: string[] = []
  if (!options.quiet && !options.plain) lines.push(banner(options), '')

  lines.push(
    s.info(`Scanned ${report.filesScanned} file${report.filesScanned === 1 ? '' : 's'}.`),
    '',
  )

  if (isClean) {
    lines.push(cleanCelebration(options))
    return lines.join('\n')
  }

  lines.push(
    s.problem(`${report.findings.length} problem${report.findings.length === 1 ? '' : 's'} found:`),
  )
  lines.push(
    ...formatFindingsRows(
      report.findings.map((f) => ({
        location: f.kind,
        name: f.name,
        tag:
          f.kind === 'unused'
            ? `(${f.section}, not imported anywhere)`
            : `resolves from ${f.resolvedFrom} — not declared in package.json`,
      })),
      options,
    ),
  )

  return lines.join('\n')
}
