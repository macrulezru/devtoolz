import { banner, type VibesOptions } from '../../format/vibes.js'
import { createStyle, type Style } from '../../format/style.js'
import type { FullCheckCommandResult, FullCheckReport } from './run.js'

function statusFor(result: FullCheckCommandResult, s: Style): string {
  if (result.skipped) return s.muted('⊘')
  if (result.error || result.exitCode !== 0) return s.problem('✖')
  return s.success('✔')
}

function noteFor(result: FullCheckCommandResult, s: Style): string {
  if (result.skipped) return s.muted('skipped')
  if (result.error) return s.error(`error — ${result.error}`)
  if (result.exitCode === 0) return s.muted('clean')
  return s.heading(`${result.findingsCount} found`)
}

export function renderFullCheckReport(report: FullCheckReport, options: VibesOptions = {}): string {
  const s = createStyle(options)

  if (report.error) {
    const lines: string[] = []
    if (!options.quiet && !options.plain) lines.push(banner(options), '')
    lines.push(s.error(`Could not run full-check: ${report.error}`))
    return lines.join('\n')
  }

  const clean = report.results.filter((r) => !r.skipped && !r.error && r.exitCode === 0).length
  const withFindings = report.results.filter(
    (r) => !r.skipped && !r.error && r.exitCode !== 0,
  ).length
  const errored = report.results.filter((r) => r.error).length
  const skipped = report.results.filter((r) => r.skipped).length

  const isFullyClean = withFindings === 0 && errored === 0
  if (options.quiet && isFullyClean) return ''

  const lines: string[] = []
  if (!options.quiet && !options.plain) lines.push(banner(options), '')

  const nameWidth = Math.max(...report.results.map((r) => r.command.length))
  for (const result of report.results) {
    const status = statusFor(result, s)
    const name = s.path(result.command.padEnd(nameWidth))
    lines.push(`${status} ${name}  ${noteFor(result, s)}`)
  }

  lines.push('')
  const parts = [s.success(`${clean} clean`)]
  if (withFindings > 0) parts.push(s.heading(`${withFindings} found something`))
  if (errored > 0) parts.push(s.problem(`${errored} errored`))
  if (skipped > 0) parts.push(s.muted(`${skipped} skipped`))
  lines.push(
    `${parts.join(', ')} ${s.muted('— see')} ${s.path('`devtoolz <command> --help`')} ${s.muted('for full detail on any of them.')}`,
  )

  return lines.join('\n')
}
