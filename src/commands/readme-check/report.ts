import { banner, cleanCelebration, type VibesOptions } from '../../format/vibes.js'
import { formatFindingsRows } from '../../format/findings-list.js'
import type { ReadmeCheckReport } from './run.js'

export function renderReadmeCheckReport(
  report: ReadmeCheckReport,
  options: VibesOptions = {},
): string {
  if (report.error) {
    const lines: string[] = []
    if (!options.quiet && !options.plain) lines.push(banner(), '')
    lines.push(`Could not run readme-check: ${report.error}`)
    return lines.join('\n')
  }

  const blocksChecked = report.fileResults.reduce((sum, f) => sum + f.blocksChecked, 0)
  const isClean = report.findings.length === 0
  if (options.quiet && isClean) return ''

  const lines: string[] = []
  if (!options.quiet && !options.plain) lines.push(banner(), '')

  lines.push(
    `Typechecked ${blocksChecked} code block${blocksChecked === 1 ? '' : 's'} across ${report.fileResults.length} file${report.fileResults.length === 1 ? '' : 's'}.`,
    '',
  )

  if (isClean) {
    lines.push(cleanCelebration(options))
    return lines.join('\n')
  }

  lines.push(`${report.findings.length} problem${report.findings.length === 1 ? '' : 's'} found:`)
  lines.push(
    ...formatFindingsRows(
      report.findings.map((f) => ({
        location: `${f.file}:${f.line}:${f.column}`,
        name: f.lang,
        tag: f.message,
      })),
      options,
    ),
  )

  return lines.join('\n')
}
