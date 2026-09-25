import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const CANDIDATE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

// A NodeNext-style project writes `import { x } from './core.js'` in a
// .ts file even though the real file on disk is `./core.ts` — the
// specifier names the file's post-build extension, not its source one
// (devtoolz's own codebase does exactly this — see src/cli.ts). When the
// literal specifier doesn't resolve, each of these swaps is tried too.
const NODENEXT_SWAPS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
}

function tryFile(path: string): string | null {
  return existsSync(path) ? path : null
}

/**
 * Resolves a relative import specifier (`./foo`, `../bar/baz`) against
 * the file that contains it to a real, existing file on disk — or `null`
 * if nothing matches any of the conventions this project's commands rely
 * on elsewhere (extensionless imports, NodeNext `.js`-means-`.ts`,
 * directory-with-index). Only ever called with specifiers that already
 * look relative (`.`/`..`-prefixed) — bare package specifiers are a
 * separate concern (see utils/workspace.ts for the one case that needs
 * to resolve those, to a sibling workspace package).
 *
 * Shared by every command that walks a local import graph
 * (dead-exports, circular-imports, unused-deps) — not specific to any
 * one of them.
 */
export function resolveRelativeSpecifier(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier)

  const direct = tryFile(base)
  if (direct) return direct

  const lastDot = base.lastIndexOf('.')
  const lastSlash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'))
  const hasExt = lastDot > lastSlash
  if (hasExt) {
    const ext = base.slice(lastDot)
    const withoutExt = base.slice(0, lastDot)
    for (const swap of NODENEXT_SWAPS[ext] ?? []) {
      const swapped = tryFile(withoutExt + swap)
      if (swapped) return swapped
    }
    // Had an extension that didn't match anything above — don't also
    // try appending a second extension or treating it as a directory.
    return null
  }

  for (const ext of CANDIDATE_EXTENSIONS) {
    const withExt = tryFile(base + ext)
    if (withExt) return withExt
  }
  for (const ext of CANDIDATE_EXTENSIONS) {
    const withIndex = tryFile(join(base, `index${ext}`))
    if (withIndex) return withIndex
  }
  return null
}
