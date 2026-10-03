import { banner, type VibesOptions } from '../../format/vibes.js'
import { createStyle } from '../../format/style.js'
import { renderTable, type TableColumn } from '../../format/table.js'
import type { HashType } from './core.js'
import type { ImageHashReport } from './run.js'

const TYPE_LABEL: Record<HashType, string> = {
  blurhash: 'BlurHash',
  thumbhash: 'ThumbHash',
}

function hashTypesIn(report: ImageHashReport): HashType[] {
  const types: HashType[] = []
  if (report.entries.some((e) => e.blurhash !== undefined)) types.push('blurhash')
  if (report.entries.some((e) => e.thumbhash !== undefined)) types.push('thumbhash')
  return types
}

function imageHashTable(report: ImageHashReport, options: VibesOptions): string[] {
  const s = createStyle(options)
  const types = hashTypesIn(report)
  const columns: TableColumn[] = [
    { header: 'File', shrink: true, style: s.path },
    { header: 'Size', align: 'right', style: s.tag },
    ...types.map((type) => ({
      header: TYPE_LABEL[type],
      style: type === 'blurhash' ? s.name : s.accent,
    })),
  ]
  const rows = report.entries.map((entry) => [
    entry.file,
    `${entry.width}×${entry.height}`,
    ...types.map((type) => entry[type] ?? ''),
  ])
  return renderTable(columns, rows, options)
}

export function renderImageHashReport(report: ImageHashReport, options: VibesOptions = {}): string {
  const s = createStyle(options)
  const lines: string[] = []
  const isClean = report.errors.length === 0
  if (options.quiet && isClean) return ''

  if (!options.quiet && !options.plain) lines.push(banner(options), '')

  if (report.dryRun && report.entries.length > 0) {
    lines.push(...imageHashTable(report, options), '')
  }

  const count = report.entries.length
  lines.push(s.info(`Hashed ${count} image${count === 1 ? '' : 's'}.`))

  if (report.written.length > 0) {
    const verb = report.dryRun ? 'Would write' : 'Wrote'
    const heading = `${verb} ${report.written.length} file${report.written.length === 1 ? '' : 's'}:`
    lines.push('', report.dryRun ? s.heading(heading) : s.success(heading))
    for (const file of report.written) lines.push(`  ${s.path(file)}`)
  }

  if (report.dryRun) {
    lines.push(
      '',
      s.hint(
        report.written.length > 0
          ? '(dry run — nothing written; drop --dry-run to write the files)'
          : '(dry run — nothing written)',
      ),
    )
  }

  if (!isClean) {
    lines.push(
      '',
      s.problem(`${report.errors.length} problem${report.errors.length === 1 ? '' : 's'}:`),
    )
    for (const error of report.errors) {
      lines.push(`  ${s.path(error.file)} ${s.muted('—')} ${s.error(error.message)}`)
    }
  }

  return lines.join('\n')
}
