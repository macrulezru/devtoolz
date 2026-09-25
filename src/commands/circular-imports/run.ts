import { relative } from 'node:path'
import { walk } from '../../utils/walk.js'
import { analyzeCircularImports, type CircularImportFinding } from './core.js'

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

export interface CircularImportsRunOptions {
  paths: string[]
  cwd: string
  extensions?: string[]
  ignoreGlobs?: string[]
  respectGitignore?: boolean
  /** also report cycles made entirely of `import type` edges. default false */
  includeTypes?: boolean
}

export interface CircularImportsFileFinding {
  files: string[]
  typeOnly: boolean
}

export interface CircularImportsReport {
  filesScanned: number
  findings: CircularImportsFileFinding[]
  exitCode: number
}

export function runCircularImports(options: CircularImportsRunOptions): CircularImportsReport {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS
  const files = walk(options.paths, {
    cwd: options.cwd,
    extensions,
    ignoreGlobs: options.ignoreGlobs ?? [],
    ...(options.respectGitignore !== undefined
      ? { respectGitignore: options.respectGitignore }
      : {}),
  })

  const analysis = analyzeCircularImports(files, { includeTypes: options.includeTypes ?? false })

  const toRelative = (f: string): string => relative(options.cwd, f).split('\\').join('/')
  const findings: CircularImportFinding[] = analysis.findings.map((f) => ({
    files: f.files.map(toRelative),
    typeOnly: f.typeOnly,
  }))
  // Stable, readable order — by the cycle's first (alphabetically smallest, already canonical from core.ts) file.
  findings.sort((a, b) => (a.files[0] as string).localeCompare(b.files[0] as string))

  return {
    filesScanned: analysis.filesAnalyzed,
    findings,
    exitCode: findings.length > 0 ? 1 : 0,
  }
}
