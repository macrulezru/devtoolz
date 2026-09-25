import { resolve } from 'node:path'
import { runStripComments } from '../strip-comments/run.js'
import { runConsoleStrip } from '../console-strip/run.js'
import { runDeadExports } from '../dead-exports/run.js'
import { runCaseCheck } from '../case-check/run.js'
import { runExportsDoctor } from '../exports-doctor/run.js'
import { runReadmeCheck } from '../readme-check/run.js'
import { runUnusedDeps } from '../unused-deps/run.js'
import { runCircularImports } from '../circular-imports/run.js'
import { runEmptyCatch } from '../empty-catch/run.js'
import { runTodoReport } from '../todo-report/run.js'
import { runScriptsCheck } from '../scripts-check/run.js'
import { runOrphanTests } from '../orphan-tests/run.js'
import { runStaleTsIgnore } from '../stale-ts-ignore/run.js'

// One entry per command, in the same order `devtoolz --help` lists them —
// `stale-ts-ignore` deliberately last: it's the only one that can be slow
// (a real whole-project typecheck, run twice), so every cheap command's
// result is already in hand before the wait, instead of first.
//
// Every one of these calls is intentionally diagnostic-only: the three
// commands that CAN write to disk (`strip-comments`/`console-strip`/
// `case-check`) never get `yes`/`fix` here — `dryRun: true` is set anyway,
// as a second, explicit guarantee on top of simply never passing `yes`,
// not because it's load-bearing on its own.
const COMMANDS: {
  name: FullCheckCommandName
  run: (dir: string, onProgress?: (message: string) => void) => CommandOutcome
}[] = [
  {
    name: 'strip-comments',
    run: (dir) => {
      const report = runStripComments({ paths: ['.'], cwd: dir, dryRun: true })
      return {
        report,
        exitCode: report.exitCode,
        error: null,
        // `changes.length` alone would be a FILE count — every other
        // command's `findingsCount` is an INDIVIDUAL-item count (dead
        // exports, empty catches, ...), so summing each file's own
        // `count` keeps this one comparable in the summary table instead
        // of silently mixing units.
        findingsCount: report.changes.reduce((sum, c) => sum + c.count, 0),
      }
    },
  },
  {
    name: 'console-strip',
    run: (dir) => {
      const report = runConsoleStrip({ paths: ['.'], cwd: dir, dryRun: true })
      return {
        report,
        exitCode: report.exitCode,
        error: null,
        // Same reasoning as strip-comments above, plus `skipped` — those
        // are individual calls too (left in place, flagged for a manual
        // look), not files, so they add directly rather than needing
        // their own per-file expansion.
        findingsCount: report.changes.reduce((sum, c) => sum + c.count, 0) + report.skipped.length,
      }
    },
  },
  {
    name: 'dead-exports',
    run: (dir) => {
      const report = runDeadExports({ paths: ['.'], cwd: dir })
      return {
        report,
        exitCode: report.exitCode,
        error: null,
        findingsCount: report.findings.length,
      }
    },
  },
  {
    name: 'case-check',
    run: (dir) => {
      const report = runCaseCheck({ paths: ['.'], cwd: dir, dryRun: true })
      return {
        report,
        exitCode: report.exitCode,
        error: null,
        findingsCount: report.findings.length,
      }
    },
  },
  {
    name: 'exports-doctor',
    run: (dir) => {
      const report = runExportsDoctor({ dir })
      return {
        report,
        exitCode: report.exitCode,
        error: report.error,
        findingsCount: report.findings.length,
      }
    },
  },
  {
    name: 'readme-check',
    run: (dir) => {
      const report = runReadmeCheck({ dir })
      return {
        report,
        exitCode: report.exitCode,
        error: report.error,
        findingsCount: report.findings.length,
      }
    },
  },
  {
    name: 'unused-deps',
    run: (dir) => {
      const report = runUnusedDeps({ dir })
      return {
        report,
        exitCode: report.exitCode,
        error: report.error,
        findingsCount: report.findings.length,
      }
    },
  },
  {
    name: 'circular-imports',
    run: (dir) => {
      const report = runCircularImports({ paths: ['.'], cwd: dir })
      return {
        report,
        exitCode: report.exitCode,
        error: null,
        findingsCount: report.findings.length,
      }
    },
  },
  {
    name: 'empty-catch',
    run: (dir) => {
      const report = runEmptyCatch({ paths: ['.'], cwd: dir })
      return {
        report,
        exitCode: report.exitCode,
        error: null,
        findingsCount: report.findings.length,
      }
    },
  },
  {
    name: 'todo-report',
    run: (dir) => {
      const report = runTodoReport({ paths: ['.'], cwd: dir })
      return {
        report,
        exitCode: report.exitCode,
        error: null,
        findingsCount: report.findings.length,
      }
    },
  },
  {
    name: 'scripts-check',
    run: (dir) => {
      const report = runScriptsCheck({ dir })
      return {
        report,
        exitCode: report.exitCode,
        error: report.error,
        findingsCount: report.findings.length,
      }
    },
  },
  {
    name: 'orphan-tests',
    run: (dir) => {
      const report = runOrphanTests({ paths: ['.'], cwd: dir })
      return {
        report,
        exitCode: report.exitCode,
        error: report.error,
        findingsCount: report.findings.length,
      }
    },
  },
  {
    name: 'stale-ts-ignore',
    run: (dir, onProgress) => {
      const report = runStaleTsIgnore({ dir, ...(onProgress ? { onProgress } : {}) })
      return {
        report,
        exitCode: report.exitCode,
        error: report.error,
        findingsCount: report.findings.length,
      }
    },
  },
]

export type FullCheckCommandName =
  | 'strip-comments'
  | 'console-strip'
  | 'dead-exports'
  | 'case-check'
  | 'exports-doctor'
  | 'readme-check'
  | 'unused-deps'
  | 'circular-imports'
  | 'empty-catch'
  | 'todo-report'
  | 'scripts-check'
  | 'orphan-tests'
  | 'stale-ts-ignore'

export const FULL_CHECK_COMMAND_NAMES: readonly FullCheckCommandName[] = COMMANDS.map((c) => c.name)

/** `stale-ts-ignore` is the only command a bare `full-check` run should ever warn about — see cli.ts's interactive prompt. */
export const SLOW_FULL_CHECK_COMMAND: FullCheckCommandName = 'stale-ts-ignore'

interface CommandOutcome {
  report: unknown
  exitCode: number
  error: string | null
  findingsCount: number
}

export interface FullCheckCommandResult {
  command: FullCheckCommandName
  skipped: boolean
  findingsCount: number
  exitCode: number
  error: string | null
  /** the command's own real report — `StripCommentsReport`, `DeadExportsReport`, etc.; `null` when skipped */
  report: unknown
}

export interface FullCheckRunOptions {
  /** directory every command scans/reads from — same one for all thirteen, deliberately (see unused-deps' own [dir]-only design for why one shared root matters) */
  dir: string
  /** command names to skip entirely, e.g. ['stale-ts-ignore'] */
  skip?: string[]
  /** called right before each non-skipped command starts */
  onCommandStart?: (command: FullCheckCommandName) => void
  /** called right after each command finishes (or is skipped) */
  onCommandDone?: (result: FullCheckCommandResult) => void
  /** forwarded only to stale-ts-ignore — its own "this can take a while" notice */
  onProgress?: (message: string) => void
}

export interface FullCheckReport {
  results: FullCheckCommandResult[]
  /** an unknown name in `skip` — a different kind of problem than any single command's own result */
  error: string | null
  exitCode: number
}

export function runFullCheck(options: FullCheckRunOptions): FullCheckReport {
  const dir = resolve(options.dir)
  const skip = new Set(options.skip ?? [])

  const unknown = [...skip].filter(
    (name) => !FULL_CHECK_COMMAND_NAMES.includes(name as FullCheckCommandName),
  )
  if (unknown.length > 0) {
    return {
      results: [],
      error: `unknown command name(s) for --skip: ${unknown.join(', ')} — valid names: ${FULL_CHECK_COMMAND_NAMES.join(', ')}`,
      exitCode: 1,
    }
  }

  const results: FullCheckCommandResult[] = []
  for (const entry of COMMANDS) {
    if (skip.has(entry.name)) {
      const result: FullCheckCommandResult = {
        command: entry.name,
        skipped: true,
        findingsCount: 0,
        exitCode: 0,
        error: null,
        report: null,
      }
      results.push(result)
      options.onCommandDone?.(result)
      continue
    }

    options.onCommandStart?.(entry.name)

    let outcome: CommandOutcome
    try {
      outcome = entry.run(dir, options.onProgress)
    } catch (err) {
      outcome = {
        report: null,
        exitCode: 1,
        error: err instanceof Error ? err.message : String(err),
        findingsCount: 0,
      }
    }

    const result: FullCheckCommandResult = {
      command: entry.name,
      skipped: false,
      findingsCount: outcome.findingsCount,
      exitCode: outcome.exitCode,
      error: outcome.error,
      report: outcome.report,
    }
    results.push(result)
    options.onCommandDone?.(result)
  }

  return {
    results,
    error: null,
    exitCode: results.some((r) => r.exitCode !== 0) ? 1 : 0,
  }
}
