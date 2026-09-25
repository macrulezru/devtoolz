import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { walk } from '../../utils/walk.js'
import { findNearestPackageDir } from '../../utils/find-package-dir.js'
import { detectWorkspace } from '../../utils/workspace.js'
import { analyzeUnusedDeps, type UnusedDepsFinding } from './core.js'

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

export interface UnusedDepsRunOptions {
  /** package directory to check — both the scan root and where package.json is looked up from, deliberately the same value (see below) */
  dir: string
  extensions?: string[]
  ignoreGlobs?: string[]
  respectGitignore?: boolean
  strict?: boolean
  ignorePackages?: string[]
}

export interface UnusedDepsReport {
  filesScanned: number
  findings: UnusedDepsFinding[]
  /** package.json couldn't be found/read at all — a different kind of problem than any single finding */
  error: string | null
  exitCode: number
}

// A single [dir] argument, not the [paths...] + --cwd shape most other
// commands use — deliberately. unused-deps compares a package.json's
// declared dependencies against real source usage, so scanning one
// directory tree while consulting a DIFFERENT one's package.json (e.g.
// `--cwd` still defaulted to wherever the CLI happened to be invoked
// from, while `paths` pointed somewhere else entirely) would silently
// check the wrong dependency list — caught for real while dogfooding
// against sibling packages from inside devtoolz's own checkout, not by
// a test: findings named devtoolz's OWN dependencies (`commander`,
// `diff`, `ignore`) against a completely different package's source.
// One shared root removes the possibility entirely.
export function runUnusedDeps(options: UnusedDepsRunOptions): UnusedDepsReport {
  const scanRoot = resolve(options.dir)
  const packageDir = findNearestPackageDir(scanRoot)
  if (!packageDir) {
    return {
      filesScanned: 0,
      findings: [],
      error: `no package.json found at or above ${scanRoot}`,
      exitCode: 1,
    }
  }

  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(readFileSync(`${packageDir}/package.json`, 'utf8')) as Record<string, unknown>
  } catch (err) {
    return {
      filesScanned: 0,
      findings: [],
      error: err instanceof Error ? err.message : String(err),
      exitCode: 1,
    }
  }

  const extensions = options.extensions ?? DEFAULT_EXTENSIONS
  const files = walk(['.'], {
    cwd: scanRoot,
    extensions,
    ignoreGlobs: options.ignoreGlobs ?? [],
    ...(options.respectGitignore !== undefined
      ? { respectGitignore: options.respectGitignore }
      : {}),
  })

  const workspace = detectWorkspace(scanRoot)
  const workspacePackageNames = new Set(workspace?.packages.map((p) => p.name) ?? [])

  const analysis = analyzeUnusedDeps(files, {
    packageDir,
    pkg,
    strict: options.strict ?? false,
    ignorePackages: new Set(options.ignorePackages ?? []),
    workspacePackageNames,
  })

  const findings = [...analysis.findings].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  )

  return {
    filesScanned: analysis.filesAnalyzed,
    findings,
    error: null,
    exitCode: findings.length > 0 ? 1 : 0,
  }
}
