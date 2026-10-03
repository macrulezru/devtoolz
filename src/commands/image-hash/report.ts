import { banner, type VibesOptions } from '../../format/vibes.js'
import type { ImageHashReport } from './run.js'

export function renderImageHashReport(report: ImageHashReport, options: VibesOptions = {}): string {
  const lines: string[] = []
  const isClean = report.errors.length === 0
  if (options.quiet && isClean) return ''

  if (!options.quiet && !options.plain) lines.push(banner(), '')

  const count = report.entries.length
  lines.push(`Hashed ${count} image${count === 1 ? '' : 's'}.`)

  if (report.written.length > 0) {
    lines.push('', `Wrote ${report.written.length} file${report.written.length === 1 ? '' : 's'}:`)
    for (const file of report.written) lines.push(`  ${file}`)
  }

  if (!isClean) {
    lines.push('', `${report.errors.length} problem${report.errors.length === 1 ? '' : 's'}:`)
    for (const error of report.errors) lines.push(`  ${error.file} — ${error.message}`)
  }

  return lines.join('\n')
}
