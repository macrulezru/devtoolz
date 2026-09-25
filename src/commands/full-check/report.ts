import { banner, isFancyOutputEnabled, type VibesOptions } from '../../format/vibes.js'
import { colorize, DIM, GREEN, RED } from '../../format/colors.js'
import type { FullCheckCommandResult, FullCheckReport } from './run.js'

function statusFor(result: FullCheckCommandResult, fancy: boolean): string {
  if (result.skipped) return fancy ? colorize(DIM, '⊘') : '⊘'
  if (result.error) return fancy ? colorize(RED, '✖') : '✖'
  if (result.exitCode !== 0) return fancy ? colorize(RED, '✖') : '✖'
  return fancy ? colorize(GREEN, '✔') : '✔'
}

function noteFor(result: FullCheckCommandResult): string {
  if (result.skipped) return 'skipped'
  if (result.error) return `error — ${result.error}`
  if (result.exitCode === 0) return 'clean'
  return `${result.findingsCount} found`
}

export function renderFullCheckReport(report: FullCheckReport, options: VibesOptions = {}): string {
  if (report.error) {
    const lines: string[] = []
    if (!options.quiet && !options.plain) lines.push(banner(), '')
    lines.push(`Could not run full-check: ${report.error}`)
    return lines.join('\n')
  }

  const fancy = isFancyOutputEnabled(options)
  const clean = report.results.filter((r) => !r.skipped && !r.error && r.exitCode === 0).length
  const withFindings = report.results.filter(
    (r) => !r.skipped && !r.error && r.exitCode !== 0,
  ).length
  const errored = report.results.filter((r) => r.error).length
  const skipped = report.results.filter((r) => r.skipped).length

  const isFullyClean = withFindings === 0 && errored === 0
  if (options.quiet && isFullyClean) return ''

  const lines: string[] = []
  if (!options.quiet && !options.plain) lines.push(banner(), '')

  const nameWidth = Math.max(...report.results.map((r) => r.command.length))
  for (const result of report.results) {
    const status = statusFor(result, fancy)
    const name = result.command.padEnd(nameWidth)
    const note = noteFor(result)
    const styledNote =
      fancy && (result.skipped || (!result.error && result.exitCode === 0))
        ? colorize(DIM, note)
        : note
    lines.push(`${status} ${name}  ${styledNote}`)
  }

  lines.push('')
  const parts = [`${clean} clean`]
  if (withFindings > 0) parts.push(`${withFindings} found something`)
  if (errored > 0) parts.push(`${errored} errored`)
  if (skipped > 0) parts.push(`${skipped} skipped`)
  lines.push(
    `${parts.join(', ')} — see \`devtoolz <command> --help\` for full detail on any of them.`,
  )

  return lines.join('\n')
}
