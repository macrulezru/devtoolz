import {
  banner,
  cleanCelebration,
  isFancyOutputEnabled,
  type VibesOptions,
} from '../../format/vibes.js'
import { colorize, DIM, WHITE } from '../../format/colors.js'
import type { CircularImportsReport } from './run.js'

/**
 * A cycle doesn't fit the flat file:line/name/tag shape formatFindingsRows
 * expects — it's a chain of files closing back on itself — so it gets its
 * own small block renderer instead, one cycle per block, files in order.
 */
function formatCycle(files: string[], typeOnly: boolean, options: VibesOptions): string[] {
  const fancy = isFancyOutputEnabled(options)
  const chain = [...files, files[0]]
  const lines = chain.map((file, i) => {
    const prefix = i === 0 ? '  ' : '  → '
    return `${prefix}${fancy ? colorize(WHITE, file as string) : file}`
  })
  if (typeOnly) {
    const note = '(type-only — harmless at runtime, types are erased)'
    lines.push(`  ${fancy ? colorize(DIM, note) : note}`)
  }
  return lines
}

export function renderCircularImportsReport(
  report: CircularImportsReport,
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

  lines.push(
    `${report.findings.length} circular import${report.findings.length === 1 ? '' : 's'} found:`,
    '',
  )
  report.findings.forEach((finding, i) => {
    lines.push(...formatCycle(finding.files, finding.typeOnly, options))
    if (i < report.findings.length - 1) lines.push('')
  })

  return lines.join('\n')
}
