import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * Walks up from `fromDir` looking for `node_modules/<packageName>` —
 * npm/yarn/pnpm all create this top-level symlink/directory for a
 * package that's actually installed and resolvable, even when pnpm's
 * real content lives in a `.pnpm` store elsewhere. Returns the resolved
 * directory, or null if the package isn't installed anywhere up the
 * tree (a broken import, not this command's concern — see core.ts).
 */
export function resolvePackageDir(fromDir: string, packageName: string): string | null {
  let dir = resolve(fromDir)
  for (;;) {
    const candidate = join(dir, 'node_modules', packageName)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** The bin command name(s) a package declares in its own package.json, if it's installed and readable. */
export function declaredBinNames(fromDir: string, packageName: string): string[] {
  const pkgDir = resolvePackageDir(fromDir, packageName)
  if (!pkgDir) return []
  try {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >
    if (typeof pkg.bin === 'string') return [packageName]
    if (pkg.bin && typeof pkg.bin === 'object')
      return Object.keys(pkg.bin as Record<string, unknown>)
    return []
  } catch {
    return []
  }
}
