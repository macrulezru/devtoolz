import { readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve as resolvePath } from 'node:path'
import { walk } from '../../utils/walk.js'
import { unifiedDiff } from '../../utils/diff.js'
import { checkFile, type CaseCheckFinding } from './core.js'
import { findTsconfig, loadTsconfigPaths, type TsconfigPaths } from './tsconfig-paths.js'

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.vue']

export interface CaseCheckRunOptions {
  paths: string[]
  cwd: string
  extensions?: string[]
  ignoreGlobs?: string[]
  respectGitignore?: boolean
  /** explicit tsconfig.json path — auto-detected upward from --cwd by default */
  tsconfig?: string
  /** apply fixes to non-alias findings */
  fix?: boolean
  dryRun?: boolean
  yes?: boolean
  diff?: boolean
}

export interface CaseCheckFileFinding extends CaseCheckFinding {
  file: string
}

export interface CaseCheckFileChange {
  file: string
  count: number
  diff?: string
}

export interface CaseCheckReport {
  filesScanned: number
  findings: CaseCheckFileFinding[]
  changes: CaseCheckFileChange[]
  applied: boolean
  exitCode: number
}

function applyFixes(text: string, findings: CaseCheckFinding[]): string {
  const sorted = [...findings].sort((a, b) => a.start - b.start)
  let out = ''
  let cursor = 0
  for (const f of sorted) {
    const quote = text[f.start] ?? "'"
    out += text.slice(cursor, f.start)
    out += `${quote}${f.correctedSpecifier}${quote}`
    cursor = f.end
  }
  out += text.slice(cursor)
  return out
}

export function runCaseCheck(options: CaseCheckRunOptions): CaseCheckReport {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS
  const files = walk(options.paths, {
    cwd: options.cwd,
    extensions,
    ...(options.ignoreGlobs ? { ignoreGlobs: options.ignoreGlobs } : {}),
    ...(options.respectGitignore !== undefined
      ? { respectGitignore: options.respectGitignore }
      : {}),
  })

  const tsconfigPath = options.tsconfig
    ? resolvePath(options.cwd, options.tsconfig)
    : findTsconfig(options.cwd)
  const paths: TsconfigPaths | null = tsconfigPath ? loadTsconfigPaths(tsconfigPath) : null

  const willApply = options.fix === true && options.yes === true && options.dryRun !== true

  const findings: CaseCheckFileFinding[] = []
  const changes: CaseCheckFileChange[] = []

  for (const file of files) {
    const before = readFileSync(file, 'utf8')
    const fileFindings = checkFile(before, file, paths)
    if (fileFindings.length === 0) continue

    const relFile = relative(options.cwd, file).split('\\').join('/')
    for (const f of fileFindings) findings.push({ ...f, file: relFile })

    const fixable = fileFindings.filter((f) => !f.isAlias)
    if (options.fix && fixable.length > 0) {
      const after = applyFixes(before, fixable)
      const change: CaseCheckFileChange = { file: relFile, count: fixable.length }
      if (options.diff) change.diff = unifiedDiff(relFile, before, after)
      changes.push(change)
      if (willApply) writeFileSync(file, after)
    }
  }

  // Once fixes are actually applied, only the alias findings (never
  // auto-fixed — see CaseCheckFinding.isAlias) still represent something
  // left for a human to do; everything else just got handled. When
  // nothing was applied (no --fix, dry-run, or missing -y), every finding
  // still counts, same as the other commands' "there's something here"
  // exit-code convention.
  const remaining = willApply ? findings.filter((f) => f.isAlias).length : findings.length

  return {
    filesScanned: files.length,
    findings,
    changes,
    applied: willApply,
    exitCode: remaining > 0 ? 1 : 0,
  }
}
