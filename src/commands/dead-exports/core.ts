import { readFileSync } from 'node:fs'
import { analyzeFile, type FileAnalysis } from '../../utils/parse-module.js'
import { resolveRelativeSpecifier } from '../../utils/resolve-specifier.js'
import { resolvePublicEntries } from './entry.js'
import type { WorkspaceInfo } from '../../utils/workspace.js'

export interface DeadExportFinding {
  name: string
  file: string
  line: number
  isType: boolean
  isDefault: boolean
}

export interface DeadExportsAnalysis {
  findings: DeadExportFinding[]
  filesAnalyzed: number
  hasUnresolvableDynamicImports: boolean
}

export interface AnalyzeOptions {
  publicEntries: Set<string>
  strict: boolean
  workspace: WorkspaceInfo | null
}

function specifierKey(file: string, name: string): string {
  return `${file}::${name}`
}

export function analyzeDeadExports(files: string[], options: AnalyzeOptions): DeadExportsAnalysis {
  const analyses = new Map<string, FileAnalysis>()
  let hasUnresolvableDynamicImports = false

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const analysis = analyzeFile(text, file)
    analyses.set(file, analysis)
    if (analysis.hasUnresolvableDynamicImport) hasUnresolvableDynamicImports = true
  }

  const workspaceEntryCache = new Map<string, string | null>()
  function resolveWorkspaceBareSpecifier(specifier: string): string | null {
    if (!options.workspace) return null
    if (workspaceEntryCache.has(specifier))
      return workspaceEntryCache.get(specifier) as string | null

    const pkg = options.workspace.packages.find(
      (p) => p.name === specifier || specifier.startsWith(`${p.name}/`),
    )
    let result: string | null = null
    if (pkg && specifier === pkg.name) {
      const entries = resolvePublicEntries(pkg.rootDir)
      result = entries[0] ?? null
    }
    // A subpath import (`@scope/pkg/sub`) isn't resolved — out of scope
    // for this command; left unresolved rather than guessed at.
    workspaceEntryCache.set(specifier, result)
    return result
  }

  function resolveSpecifier(fromFile: string, specifier: string): string | null {
    if (specifier.startsWith('.')) return resolveRelativeSpecifier(fromFile, specifier)
    return resolveWorkspaceBareSpecifier(specifier)
  }

  function resolveExportOrigin(
    file: string,
    name: string,
    visited: Set<string> = new Set(),
  ): { file: string; name: string } | null {
    if (visited.has(file)) return null
    visited.add(file)
    const analysis = analyses.get(file)
    if (!analysis) return null

    if (analysis.exports.some((e) => e.name === name)) return { file, name }

    for (const r of analysis.reexports) {
      if (r.imported === '*' || r.exportedAs !== name) continue
      const nextFile = resolveSpecifier(file, r.from)
      if (!nextFile) return null // reexported from something we can't see into (external package) — don't guess
      return (
        resolveExportOrigin(nextFile, r.imported, visited) ?? { file: nextFile, name: r.imported }
      )
    }

    for (const r of analysis.reexports) {
      if (r.imported !== '*') continue
      const nextFile = resolveSpecifier(file, r.from)
      if (!nextFile) continue
      const found = resolveExportOrigin(nextFile, name, visited)
      if (found) return found
    }

    return null
  }

  // Reused for two different purposes below: marking everything a
  // namespace/dynamic import can reach as USED, and (separately) marking
  // everything reachable from a public entry point's own export surface
  // as PUBLIC — an `index.ts` that's nothing but `export { x } from
  // './x.js'` re-exports is the normal shape for a library barrel, and
  // the symbols it re-exports are just as public as ones declared
  // directly in the entry file itself, even though this walk is what
  // discovers that, not the file's own literal declaration list.
  function markAllReachable(
    file: string,
    target: Set<string>,
    visited: Set<string> = new Set(),
  ): void {
    if (visited.has(file)) return
    visited.add(file)
    const analysis = analyses.get(file)
    if (!analysis) return
    for (const e of analysis.exports) target.add(specifierKey(file, e.name))
    for (const r of analysis.reexports) {
      const nextFile = resolveSpecifier(file, r.from)
      if (!nextFile) continue
      if (r.imported === '*') {
        // `export * from './y'` genuinely re-exports everything in './y'.
        markAllReachable(nextFile, target, visited)
      } else {
        // `export { x } from './y'` re-exports ONLY x — walking into './y'
        // and marking its entire export list reachable (the old behavior)
        // wrongly exempted every OTHER unrelated export in that file too,
        // hiding genuinely dead ones behind an unrelated barrel re-export.
        const origin = resolveExportOrigin(nextFile, r.imported)
        target.add(
          origin ? specifierKey(origin.file, origin.name) : specifierKey(nextFile, r.imported),
        )
      }
    }
  }

  const usedSymbols = new Set<string>()
  for (const [file, analysis] of analyses) {
    for (const imp of analysis.imports) {
      const target = resolveSpecifier(file, imp.from)
      if (!target) continue

      if (imp.imported === '*') {
        markAllReachable(target, usedSymbols)
        continue
      }

      const origin = resolveExportOrigin(target, imp.imported)
      usedSymbols.add(
        origin ? specifierKey(origin.file, origin.name) : specifierKey(target, imp.imported),
      )
    }
  }

  const publiclyReachable = new Set<string>()
  if (!options.strict) {
    for (const entry of options.publicEntries) markAllReachable(entry, publiclyReachable)
  }

  const findings: DeadExportFinding[] = []
  for (const [file, analysis] of analyses) {
    for (const e of analysis.exports) {
      const key = specifierKey(file, e.name)
      if (usedSymbols.has(key)) continue
      if (publiclyReachable.has(key)) continue
      findings.push({ name: e.name, file, line: e.line, isType: e.isType, isDefault: e.isDefault })
    }
  }

  return { findings, filesAnalyzed: files.length, hasUnresolvableDynamicImports }
}
