import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Walks up from `startDir` to the nearest ancestor directory containing a `package.json`. */
export function findNearestPackageDir(startDir: string): string | null {
  let dir = resolve(startDir)
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}
