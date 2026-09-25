// Verifies a relative specifier's casing against what's REALLY on disk —
// via `readdirSync`, never via `existsSync`/`statSync` on the literal
// path, which Windows/Mac would happily confirm even with the wrong case
// (case-insensitive filesystems by default) and Linux CI would then fail
// on for real. This is the whole point of the command: catch it here,
// not there.

import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const CANDIDATE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.json']

// A NodeNext-style project writes `'./foo.js'` even though the real file
// on disk is `foo.ts` (devtoolz's own source does this throughout — see
// resolve.ts in dead-exports for the same convention). Case-checking a
// literal `.js` specifier against a real `.ts` file needs to know these
// are the SAME file before it can even get to comparing case, or a
// perfectly fine NodeNext import looks like a broken one, not a case
// mismatch. The corrected specifier still keeps the WRITTEN extension
// (`.js`) — only the base name's case is ever changed, never the
// extension the codebase's own convention chose to write.
const NODENEXT_SWAPS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
}

export interface CaseCheckOutcome {
  /** the specifier with every segment's real on-disk casing substituted in */
  correctedSpecifier: string
}

function extensionOf(name: string, from: readonly string[] = CANDIDATE_EXTENSIONS): string | null {
  return from.find((ext) => name.endsWith(ext)) ?? null
}

function realEntryFor(dir: string, name: string): { name: string; exact: boolean } | null {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  if (entries.includes(name)) return { name, exact: true }
  const lower = name.toLowerCase()
  const match = entries.find((e) => e.toLowerCase() === lower)
  return match ? { name: match, exact: false } : null
}

/**
 * Same idea as `realEntryFor`, but for a specifier segment that already
 * names a file extension (`foo.js`) — also tries every NodeNext-
 * equivalent real extension (`foo.ts`, `foo.tsx`, ...) before giving up,
 * exact match across all candidates first, then case-insensitive.
 * Returns the matched real file's BASE NAME (case-corrected, extension
 * stripped) — the caller re-attaches the ORIGINALLY WRITTEN extension.
 */
function realFileBaseFor(
  dir: string,
  nameWithExt: string,
  writtenExt: string,
): { base: string; exact: boolean } | null {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  const base = nameWithExt.slice(0, nameWithExt.length - writtenExt.length)
  const candidateExts = [writtenExt, ...(NODENEXT_SWAPS[writtenExt] ?? [])]

  for (const ext of candidateExts) {
    const candidate = base + ext
    if (entries.includes(candidate)) return { base, exact: true }
  }
  for (const ext of candidateExts) {
    const candidateLower = (base + ext).toLowerCase()
    const match = entries.find((e) => e.toLowerCase() === candidateLower)
    if (match) {
      const matchedExt = extensionOf(match, candidateExts) ?? ext
      return { base: match.slice(0, match.length - matchedExt.length), exact: false }
    }
  }
  return null
}

/**
 * Returns `{ correctedSpecifier }` if `specifier` (as written in
 * `fromFile`) differs in case from what's really on disk anywhere along
 * its path, or `null` if it's already correct — OR if it doesn't resolve
 * to anything at all (a genuinely broken import is a different problem,
 * not this command's to report). Only relative specifiers (`.`/`..`
 * prefixed) — bare/aliased ones are resolved to a relative-shaped target
 * by the caller first (see tsconfig-paths.ts).
 */
export function checkSpecifierCase(fromFile: string, specifier: string): CaseCheckOutcome | null {
  if (!specifier.startsWith('.')) return null

  const baseDir = dirname(fromFile)
  const segments = specifier.split('/')
  const lastSegment = segments[segments.length - 1] as string
  const hasExplicitExt = CANDIDATE_EXTENSIONS.some((ext) => lastSegment.endsWith(ext))

  let currentDir = baseDir
  const corrected: string[] = []
  let hasMismatch = false

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i] as string
    if (seg === '.' || seg === '..' || seg === '') {
      corrected.push(seg)
      currentDir = resolve(currentDir, seg)
      continue
    }
    const real = realEntryFor(currentDir, seg)
    if (!real) return null
    if (!real.exact) hasMismatch = true
    corrected.push(real.name)
    currentDir = join(currentDir, real.name)
  }

  if (hasExplicitExt) {
    const writtenExt = extensionOf(lastSegment) as string // hasExplicitExt guarantees a match
    const real = realFileBaseFor(currentDir, lastSegment, writtenExt)
    if (!real) return null
    if (!real.exact) hasMismatch = true
    corrected.push(real.base + writtenExt)
    return hasMismatch ? { correctedSpecifier: corrected.join('/') } : null
  }

  // No extension in the specifier — try resolving it as a FILE (guessing
  // the extension) before falling back to "it's a directory with an
  // index file inside".
  let entries: string[]
  try {
    entries = readdirSync(currentDir)
  } catch {
    return null
  }

  for (const ext of CANDIDATE_EXTENSIONS) {
    if (entries.includes(lastSegment + ext)) {
      corrected.push(lastSegment)
      return hasMismatch ? { correctedSpecifier: corrected.join('/') } : null
    }
  }
  for (const ext of CANDIDATE_EXTENSIONS) {
    const target = (lastSegment + ext).toLowerCase()
    const match = entries.find((e) => e.toLowerCase() === target)
    if (match) {
      const realBase = match.slice(0, match.length - ext.length)
      corrected.push(realBase)
      return { correctedSpecifier: corrected.join('/') } // extension case can differ too, but we only ever write the base name back — always worth flagging if the base itself needed a real-case swap
    }
  }

  // Not a file — try as a directory containing an index file.
  const realDir = realEntryFor(currentDir, lastSegment)
  if (!realDir) return null
  if (!realDir.exact) hasMismatch = true

  const dirPath = join(currentDir, realDir.name)
  let dirEntries: string[]
  try {
    dirEntries = readdirSync(dirPath)
  } catch {
    return null
  }
  const hasIndex = CANDIDATE_EXTENSIONS.some((ext) => dirEntries.includes(`index${ext}`))
  if (!hasIndex) return null // not actually a resolvable directory import — not this command's problem

  corrected.push(realDir.name)
  return hasMismatch ? { correctedSpecifier: corrected.join('/') } : null
}
