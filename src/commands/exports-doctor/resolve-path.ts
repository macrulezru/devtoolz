// Checks one declared path against what's REALLY on disk, segment by
// segment, via `readdirSync` — same discipline as case-check, but here a
// missing file is the PRIMARY thing being looked for (case-check treats
// "doesn't resolve at all" as out of scope; here it's the main case),
// so the result is three-way instead of a plain yes/no.

import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type PathCheckResult =
  { status: 'ok' } | { status: 'missing' } | { status: 'case-mismatch'; realPath: string }

export function checkDeclaredPath(packageDir: string, declaredPath: string): PathCheckResult {
  const segments = declaredPath
    .replace(/^\.\//, '')
    .split('/')
    .filter((s) => s.length > 0)
  if (segments.length === 0) return { status: 'missing' }

  let currentDir = packageDir
  const corrected: string[] = []
  let hasMismatch = false

  for (const segment of segments) {
    let entries: string[]
    try {
      entries = readdirSync(currentDir)
    } catch {
      return { status: 'missing' }
    }

    if (entries.includes(segment)) {
      corrected.push(segment)
    } else {
      const lower = segment.toLowerCase()
      const match = entries.find((e) => e.toLowerCase() === lower)
      if (!match) return { status: 'missing' }
      hasMismatch = true
      corrected.push(match)
    }
    currentDir = join(currentDir, corrected[corrected.length - 1] as string)
  }

  if (hasMismatch) return { status: 'case-mismatch', realPath: `./${corrected.join('/')}` }
  return { status: 'ok' }
}

export function resolveDeclaredPath(packageDir: string, declaredPath: string): string {
  return resolve(packageDir, declaredPath)
}
