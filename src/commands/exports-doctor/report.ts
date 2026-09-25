import { banner, cleanCelebration, type VibesOptions } from '../../format/vibes.js'
import { formatFindingsRows } from '../../format/findings-list.js'
import type { ExportsDoctorReport } from './run.js'

const KIND_LABEL: Record<string, (path: string, realPath?: string) => string> = {
  missing: () => 'file does not exist',
  'case-mismatch': (_path, realPath) => `wrong case — real path is ${realPath}`,
  'missing-shebang': () => "missing '#!/usr/bin/env node' — won't run as a bin",
  'types-missing': () => 'runtime resolves fine, but no types declared for this entry at all',
}

export function renderExportsDoctorReport(
  report: ExportsDoctorReport,
  options: VibesOptions = {},
): string {
  if (report.error) {
    const lines: string[] = []
    if (!options.quiet && !options.plain) lines.push(banner(), '')
    lines.push(`Could not read package.json: ${report.error}`)
    return lines.join('\n')
  }

  const isClean = report.findings.length === 0
  if (options.quiet && isClean) return ''

  const lines: string[] = []
  if (!options.quiet && !options.plain) lines.push(banner(), '')

  lines.push(`Checked ${report.packageName ?? 'this package'}'s declared exports.`, '')

  if (isClean) {
    lines.push(cleanCelebration(options))
    return lines.join('\n')
  }

  lines.push(`${report.findings.length} problem${report.findings.length === 1 ? '' : 's'} found:`)
  lines.push(
    ...formatFindingsRows(
      report.findings.map((f) => ({
        location: f.location,
        name: f.path,
        tag: KIND_LABEL[f.kind]?.(f.path, f.realPath) ?? f.kind,
      })),
      options,
    ),
  )

  return lines.join('\n')
}
