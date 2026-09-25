import { relative } from 'node:path'
import { walk } from '../../utils/walk.js'
import { analyzeDeadExports, type DeadExportFinding } from './core.js'
import { resolvePublicEntries } from './entry.js'
import { findNearestPackageDir } from '../../utils/find-package-dir.js'
import { detectWorkspace } from '../../utils/workspace.js'

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

// Build-tool config files (tsup.config.ts, vitest.config.ts, ...) are
// loaded by that tool's own CLI via filename convention, never through a
// same-repo `import` — no static analysis can see that consumer, so their
// default export always looks unused. Confirmed against a real project
// (inview's own packages/*/tsup.config.ts) rather than assumed. Excluded
// from the scan entirely, same as `--ignore` would, rather than special-
// cased per-finding — a config file has essentially nothing else in it
// worth dead-code-checking anyway.
const DEFAULT_CONFIG_IGNORES = ['*.config.ts', '*.config.js', '*.config.mjs', '*.config.cjs']

export interface DeadExportsRunOptions {
  paths: string[]
  cwd: string
  extensions?: string[]
  ignoreGlobs?: string[]
  respectGitignore?: boolean
  /** extra public-entry files, on top of the auto-detected ones (--entry) */
  entry?: string[]
  /** also flag exports from public entry points. default false */
  strict?: boolean
  /** auto-detect a pnpm/npm/yarn workspace for cross-package resolution. default true */
  workspace?: boolean
}

export interface DeadExportsReport {
  filesScanned: number
  findings: DeadExportFinding[]
  hasUnresolvableDynamicImports: boolean
  exitCode: number
}

export function runDeadExports(options: DeadExportsRunOptions): DeadExportsReport {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS
  const files = walk(options.paths, {
    cwd: options.cwd,
    extensions,
    ignoreGlobs: [...DEFAULT_CONFIG_IGNORES, ...(options.ignoreGlobs ?? [])],
    ...(options.respectGitignore !== undefined
      ? { respectGitignore: options.respectGitignore }
      : {}),
  })

  const packageDir = findNearestPackageDir(options.cwd) ?? options.cwd
  const publicEntries = new Set(resolvePublicEntries(packageDir, options.entry ?? []))

  const workspace = options.workspace !== false ? detectWorkspace(options.cwd) : null
  if (workspace) {
    for (const pkg of workspace.packages) {
      for (const entry of resolvePublicEntries(pkg.rootDir)) publicEntries.add(entry)
    }
  }

  const analysis = analyzeDeadExports(files, {
    publicEntries,
    strict: options.strict ?? false,
    workspace,
  })

  const findings = analysis.findings
    .map((f) => ({ ...f, file: relative(options.cwd, f.file).split('\\').join('/') }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)

  const exitCode = findings.length > 0 ? 1 : 0

  return {
    filesScanned: analysis.filesAnalyzed,
    findings,
    hasUnresolvableDynamicImports: analysis.hasUnresolvableDynamicImports,
    exitCode,
  }
}
