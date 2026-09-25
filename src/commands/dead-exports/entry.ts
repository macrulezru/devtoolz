// Determines which files count as a package's PUBLIC API — exports from
// these are exempt from the dead-export check by default (see
// features.md: "не используется внутри репо" ≠ "мёртвый код" for a
// published library's own entry points).
//
// package.json's main/module/exports/bin/types point at BUILT output
// (dist/index.js), not the source this command actually analyzes — there
// is no guaranteed link back to the source file. The heuristic here (swap
// the first build-output-looking directory segment for `src`, swap the
// extension for a TS one, keep only what actually exists on disk) covers
// the common tsc/tsup/vite-library-mode layout this project's own
// packages use. `--entry` exists specifically to override this when it
// guesses wrong.

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const BUILD_DIR_NAMES = new Set(['dist', 'build', 'lib', 'out'])
const SOURCE_EXTENSIONS = ['.ts', '.tsx']

function readPackageJson(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function collectExportsMapValues(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    out.push(node)
  } else if (node && typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>))
      collectExportsMapValues(value, out)
  }
}

function guessSourcePath(packageDir: string, distRelativePath: string): string | null {
  const segments = distRelativePath.replace(/^\.\//, '').split(/[\\/]/)
  const buildIndex = segments.findIndex((s) => BUILD_DIR_NAMES.has(s))
  if (buildIndex === -1) return null

  const srcSegments = [...segments.slice(0, buildIndex), 'src', ...segments.slice(buildIndex + 1)]
  const withoutExt = srcSegments.join('/').replace(/\.(js|cjs|mjs|d\.ts)$/, '')

  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = resolve(packageDir, withoutExt + ext)
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function resolvePublicEntries(packageDir: string, extraEntries: string[] = []): string[] {
  const entries = new Set<string>()

  for (const ext of SOURCE_EXTENSIONS) {
    const defaultEntry = resolve(packageDir, 'src', `index${ext}`)
    if (existsSync(defaultEntry)) entries.add(defaultEntry)
  }

  const pkg = readPackageJson(packageDir)
  if (pkg) {
    const distCandidates: string[] = []
    for (const field of ['main', 'module', 'types', 'typings'] as const) {
      if (typeof pkg[field] === 'string') distCandidates.push(pkg[field] as string)
    }
    if (pkg.exports) collectExportsMapValues(pkg.exports, distCandidates)
    if (pkg.bin) collectExportsMapValues(pkg.bin, distCandidates)

    for (const dist of distCandidates) {
      const guessed = guessSourcePath(packageDir, dist)
      if (guessed) entries.add(guessed)
    }
  }

  for (const extra of extraEntries) {
    const resolved = resolve(packageDir, extra)
    if (existsSync(resolved)) entries.add(resolved)
  }

  return [...entries]
}
