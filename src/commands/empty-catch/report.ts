import { banner, cleanCelebration, type VibesOptions } from '../../format/vibes.js'
import { formatFindingsRows } from '../../format/findings-list.js'
import type { EmptyCatchReport } from './run.js'

const KIND_LABEL: Record<string, string> = {
  empty: "nothing done with the error — it's silently swallowed",
  'console-only': 'only logged, never handled — silently swallowed either way',
}

export function renderEmptyCatchReport(
  report: EmptyCatchReport,
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

  lines.push(`${report.findings.length} problem${report.findings.length === 1 ? '' : 's'} found:`)
  lines.push(
    ...formatFindingsRows(
      report.findings.map((f) => ({
        location: `${f.file}:${f.line}:${f.column}`,
        name: f.kind,
        tag: KIND_LABEL[f.kind] ?? f.kind,
      })),
      options,
    ),
  )

  return lines.join('\n')
}
