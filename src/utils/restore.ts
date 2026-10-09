import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createStyle } from '../format/style.js'
import type { VibesOptions } from '../format/vibes.js'
import { writeAtomic } from './atomic-write.js'
import { loadJournal } from './backup.js'
import { BackupUsageError } from './backup-error.js'
import { defaultTerminal, isInteractive, promptChoice, type TerminalIO } from './tty.js'

export type RestoreStatus =
  'restored' | 'would-restore' | 'modified' | 'missing-backup' | 'damaged-backup' | 'error'

export interface RestoreOptions {
  dir: string
  cwd: string
  dryRun?: boolean
  force?: boolean
  assumeYes?: boolean
  interactive?: boolean
  io?: TerminalIO
  style?: VibesOptions
}

export interface RestoreEntryResult {
  path: string
  status: RestoreStatus
  bytes?: number
  message?: string
}

export interface RestoreReport {
  dir: string
  dryRun: boolean
  results: RestoreEntryResult[]
  counts: Record<RestoreStatus, number>
  cancelled: boolean
  exitCode: number
}

const sha1 = (data: Buffer) => createHash('sha1').update(data).digest('hex')

export async function runRestore(options: RestoreOptions): Promise<RestoreReport> {
  const dir = resolve(options.cwd, options.dir)
  const journal = loadJournal(dir)
  const io = options.io ?? defaultTerminal()
  const interactive = options.interactive ?? isInteractive(io)
  const report: RestoreReport = {
    dir,
    dryRun: Boolean(options.dryRun),
    results: [],
    counts: {
      restored: 0,
      'would-restore': 0,
      modified: 0,
      'missing-backup': 0,
      'damaged-backup': 0,
      error: 0,
    },
    cancelled: false,
    exitCode: 0,
  }

  if (!options.dryRun && !options.assumeYes) {
    if (!interactive) {
      throw new BackupUsageError(
        'restore overwrites the current files with the saved originals — confirm it first (or preview with a dry run)',
      )
    }
    const style = createStyle(options.style ?? {})
    const answer = await promptChoice(
      io,
      `${style.warn('Restore')} ${style.value(`${journal.entries.length} files`)} from ${style.path(dir)}?`,
      [
        { key: 'y', label: 'restore' },
        { key: 'n', label: 'cancel' },
      ],
      style,
      'n',
    )
    if (answer !== 'y') {
      report.cancelled = true
      report.exitCode = 1
      return report
    }
  }

  for (const entry of journal.entries) {
    const result: RestoreEntryResult = {
      path: entry.path,
      status: 'restored',
      bytes: entry.bytesBefore,
    }
    try {
      if (!existsSync(entry.backup)) {
        result.status = 'missing-backup'
      } else {
        const saved = readFileSync(entry.backup)
        if (sha1(saved) !== entry.hashBefore) {
          result.status = 'damaged-backup'
        } else {
          const current = existsSync(entry.path) ? sha1(readFileSync(entry.path)) : null
          if (current !== null && current !== entry.hashAfter && !options.force) {
            result.status = 'modified'
          } else if (options.dryRun) {
            result.status = 'would-restore'
          } else {
            writeAtomic(entry.path, saved)
          }
        }
      }
    } catch (error) {
      result.status = 'error'
      result.message = error instanceof Error ? error.message : String(error)
    }
    report.counts[result.status] += 1
    report.results.push(result)
  }

  const failed =
    report.counts.modified +
    report.counts['missing-backup'] +
    report.counts['damaged-backup'] +
    report.counts.error
  report.exitCode = failed > 0 ? 1 : 0
  return report
}
