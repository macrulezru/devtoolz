import { readFileSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import ts from 'typescript'
import { walk } from '../../utils/walk.js'
import { unifiedDiff } from '../../utils/diff.js'
import { stripConsole } from './core.js'
import { stripConsoleVue } from './vue.js'
import type { SkippedCall } from './core.js'

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.vue']

export interface ConsoleStripRunOptions {
  paths: string[]
  cwd: string
  extensions?: string[]
  ignoreGlobs?: string[]
  respectGitignore?: boolean
  methods?: string[]
  debugger?: boolean
  dryRun?: boolean
  yes?: boolean
  diff?: boolean
}

export interface ConsoleStripFileChange {
  file: string
  /** how many console.* / debugger statements were removed from this file */
  count: number
  diff?: string
}

export interface ConsoleStripSkipped extends SkippedCall {
  file: string
}

export interface ConsoleStripReport {
  filesScanned: number
  changes: ConsoleStripFileChange[]
  skipped: ConsoleStripSkipped[]
  applied: boolean
  exitCode: number
}

function scriptKindFor(file: string): ts.ScriptKind {
  return file.endsWith('.ts') || file.endsWith('.tsx') ? ts.ScriptKind.TS : ts.ScriptKind.JS
}

export function runConsoleStrip(options: ConsoleStripRunOptions): ConsoleStripReport {
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
  const changes: ConsoleStripFileChange[] = []
  const skipped: ConsoleStripSkipped[] = []
  const coreOptions = {
    ...(options.methods !== undefined ? { methods: options.methods } : {}),
    ...(options.debugger !== undefined ? { debugger: options.debugger } : {}),
  }

  for (const file of files) {
    const before = readFileSync(file, 'utf8')
    const result = file.endsWith('.vue')
      ? stripConsoleVue(before, coreOptions)
      : stripConsole(before, { ...coreOptions, scriptKind: scriptKindFor(file) })

    const relFile = relative(options.cwd, file).split('\\').join('/')

    for (const s of result.skipped) skipped.push({ ...s, file: relFile })

    if (!result.changed) continue

    const change: ConsoleStripFileChange = { file: relFile, count: result.count }
    if (options.diff) change.diff = unifiedDiff(relFile, before, result.text)
    changes.push(change)

    if (willApply) writeFileSync(file, result.text)
  }

  const exitCode = (!willApply && changes.length > 0) || skipped.length > 0 ? 1 : 0

  return {
    filesScanned: files.length,
    changes,
    skipped,
    applied: willApply,
    exitCode,
  }
}
