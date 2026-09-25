import { readFileSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import ts from 'typescript'
import { walk } from '../../utils/walk.js'
import { unifiedDiff } from '../../utils/diff.js'
import { stripComments } from './core.js'
import { stripVueComments } from './vue.js'

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.vue']

export interface StripCommentsRunOptions {
  paths: string[]
  cwd: string
  extensions?: string[]
  ignoreGlobs?: string[]
  respectGitignore?: boolean
  keepJsdoc?: boolean
  /** show what would change, write nothing */
  dryRun?: boolean
  /** actually write changes to disk — without this OR dryRun, behaves as a preview (nothing written) */
  yes?: boolean
  /** include a unified diff per changed file in the report */
  diff?: boolean
}

export interface StripCommentsFileChange {
  file: string
  /** how many individual comments were removed from this file */
  count: number
  diff?: string
}

export interface StripCommentsReport {
  filesScanned: number
  changes: StripCommentsFileChange[]
  /** true if changes were actually written to disk */
  applied: boolean
  exitCode: number
}

function scriptKindFor(file: string): ts.ScriptKind {
  return file.endsWith('.ts') || file.endsWith('.tsx') ? ts.ScriptKind.TS : ts.ScriptKind.JS
}

export function runStripComments(options: StripCommentsRunOptions): StripCommentsReport {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS
  const files = walk(options.paths, {
    cwd: options.cwd,
    extensions,
    ...(options.ignoreGlobs ? { ignoreGlobs: options.ignoreGlobs } : {}),
    ...(options.respectGitignore !== undefined
      ? { respectGitignore: options.respectGitignore }
      : {}),
  })

  const willApply = options.yes === true && options.dryRun !== true
  const changes: StripCommentsFileChange[] = []

  for (const file of files) {
    const before = readFileSync(file, 'utf8')
    const result = file.endsWith('.vue')
      ? stripVueComments(before, { keepJsdoc: options.keepJsdoc ?? false })
      : stripComments(before, {
          scriptKind: scriptKindFor(file),
          keepJsdoc: options.keepJsdoc ?? false,
        })

    if (!result.changed) continue

    const relFile = relative(options.cwd, file).split('\\').join('/')
    const change: StripCommentsFileChange = { file: relFile, count: result.count }
    if (options.diff) change.diff = unifiedDiff(relFile, before, result.text)
    changes.push(change)

    if (willApply) writeFileSync(file, result.text)
  }

  const exitCode = !willApply && changes.length > 0 ? 1 : 0

  return {
    filesScanned: files.length,
    changes,
    applied: willApply,
    exitCode,
  }
}
