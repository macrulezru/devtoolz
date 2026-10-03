import { banner, cleanCelebration, type VibesOptions } from '../../format/vibes.js'
import { formatFindingsRows } from '../../format/findings-list.js'
import { createStyle } from '../../format/style.js'
import type { ScriptsCheckReport } from './run.js'

const KIND_TAG: Record<string, string> = {
  missing: 'mentioned here, but not in package.json scripts',
  undocumented: 'in package.json scripts, but not mentioned anywhere checked',
}

export function renderScriptsCheckReport(
  report: ScriptsCheckReport,
  options: VibesOptions = {},
): string {
  const s = createStyle(options)
  if (report.error) {
    const lines: string[] = []
    if (!options.quiet && !options.plain) lines.push(banner(options), '')
    lines.push(s.error(`Could not run scripts-check: ${report.error}`))
    return lines.join('\n')
  }

  const isClean = report.findings.length === 0
  if (options.quiet && isClean) return ''

  const lines: string[] = []
  if (!options.quiet && !options.plain) lines.push(banner(options), '')

  lines.push(
    s.info(
      `Checked ${report.sourcesScanned.length} source${report.sourcesScanned.length === 1 ? '' : 's'} against package.json's scripts.`,
    ),
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
        location: `${f.file}:${f.line}`,
        name: f.name,
        tag: KIND_TAG[f.kind] ?? f.kind,
      })),
      options,
    ),
  )

  return lines.join('\n')
}
