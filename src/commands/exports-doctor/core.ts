import { readFileSync } from 'node:fs'
import { collectDeclaredPaths, isBinLocation, isTypesLocation } from './parse.js'
import { checkDeclaredPath, resolveDeclaredPath } from './resolve-path.js'

export type FindingKind = 'missing' | 'case-mismatch' | 'missing-shebang' | 'types-missing'

export interface ExportsDoctorFinding {
  location: string
  path: string
  kind: FindingKind
  /** the real on-disk case, only for kind: 'case-mismatch' */
  realPath?: string
}

export interface ExportsDoctorResult {
  packageName: string | null
  findings: ExportsDoctorFinding[]
}

function hasShebang(absolutePath: string): boolean {
  try {
    const fd = readFileSync(absolutePath, { encoding: 'utf8' })
    return fd.startsWith('#!')
  } catch {
    return false // unreadable — already reported as missing/case-mismatch by the caller, not a second finding
  }
}

export function checkPackage(
  pkg: Record<string, unknown>,
  packageDir: string,
): ExportsDoctorResult {
  const declared = collectDeclaredPaths(pkg)
  const findings: ExportsDoctorFinding[] = []

  // Grouped by exports subpath key (the part inside `exports["..."]`), so
  // the types-vs-runtime pairing check below only compares conditions
  // that actually belong together, not e.g. `exports["."].types` against
  // `exports["./cdn"].import`.
  const okByExportsKey = new Map<string, Set<string>>()

  for (const entry of declared) {
    const result = checkDeclaredPath(packageDir, entry.path)

    if (result.status === 'missing') {
      findings.push({ location: entry.location, path: entry.path, kind: 'missing' })
      continue
    }

    if (result.status === 'case-mismatch') {
      findings.push({
        location: entry.location,
        path: entry.path,
        kind: 'case-mismatch',
        realPath: result.realPath,
      })
      continue
    }

    // status: 'ok' from here on
    const exportsKeyMatch = entry.location.match(/^exports\["([^"]+)"\]/)
    if (exportsKeyMatch) {
      const key = exportsKeyMatch[1] as string
      const conditions = okByExportsKey.get(key) ?? new Set<string>()
      conditions.add(entry.location)
      okByExportsKey.set(key, conditions)
    }

    if (isBinLocation(entry.location)) {
      const absolute = resolveDeclaredPath(packageDir, entry.path)
      if (!hasShebang(absolute)) {
        findings.push({ location: entry.location, path: entry.path, kind: 'missing-shebang' })
      }
    }
  }

  // types-vs-runtime pairing: a `types` condition that's missing is
  // already reported above via kind: 'missing' — this second pass instead
  // looks for the OTHER direction, the one that's actually dangerous:
  // every non-types condition under a subpath resolved fine (the package
  // works at runtime), but `types` for that SAME subpath is nowhere in
  // the declared paths at all (not just missing-on-disk — never even
  // written), so TypeScript consumers get no types with no warning
  // anywhere in a normal build.
  const flaggedKeys = new Set<string>()
  for (const entry of declared) {
    // Only entries declared inside a real conditions object are eligible —
    // a bare string/array subpath value has no siblings at all, and
    // TypeScript falls back to a colocated `.d.ts` file for those, so
    // flagging them here would be a false positive.
    if (!entry.isConditionEntry || isTypesLocation(entry.location)) continue
    const exportsKeyMatch = entry.location.match(/^exports\["([^"]+)"\]/)
    if (!exportsKeyMatch) continue
    const key = exportsKeyMatch[1] as string
    if (flaggedKeys.has(key)) continue // one finding per subpath, not one per condition under it
    const hasAnyTypesDeclared = declared.some(
      (d) => d.location.startsWith(`exports["${key}"]`) && isTypesLocation(d.location),
    )
    const runtimeResolvedOk = okByExportsKey.get(key)?.has(entry.location)
    if (!hasAnyTypesDeclared && runtimeResolvedOk) {
      findings.push({ location: `exports["${key}"]`, path: entry.path, kind: 'types-missing' })
      flaggedKeys.add(key)
    }
  }

  return {
    packageName: typeof pkg.name === 'string' ? pkg.name : null,
    findings,
  }
}
