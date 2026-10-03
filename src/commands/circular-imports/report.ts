import { banner, cleanCelebration, type VibesOptions } from '../../format/vibes.js'
import { createStyle, type Style } from '../../format/style.js'
import type { CircularImportsReport } from './run.js'

/**
 * A cycle doesn't fit the flat file:line/name/tag shape formatFindingsRows
 * expects — it's a chain of files closing back on itself — so it gets its
 * own small block renderer instead, one cycle per block, files in order.
 */
function formatCycle(files: string[], typeOnly: boolean, s: Style): string[] {
  const chain = [...files, files[0]]
  const lines = chain.map((file, i) => {
    const prefix = i === 0 ? '  ' : `  ${s.accent('→')} `
    return `${prefix}${s.path(file as string)}`
  })
  if (typeOnly) {
    lines.push(`  ${s.tag('(type-only — harmless at runtime, types are erased)')}`)
  }
  return lines
}

export function renderCircularImportsReport(
  report: CircularImportsReport,
  options: VibesOptions = {},
): string {
  const s = createStyle(options)
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
    s.problem(
      `${report.findings.length} circular import${report.findings.length === 1 ? '' : 's'} found:`,
    ),
    '',
  )
  report.findings.forEach((finding, i) => {
    lines.push(...formatCycle(finding.files, finding.typeOnly, s))
    if (i < report.findings.length - 1) lines.push('')
  })

  return lines.join('\n')
}
