// Detects a pnpm/npm/yarn workspace so a sibling package's import of
// another package's export (e.g. `@macrulez/inview-vue` importing from
// `@macrulez/inview-core`, as it really does) doesn't read as a false
// "dead export" just because the reference lives in a different package
// directory than the one being checked — the exact case features.md's
// contract calls out. Shared by every command that needs to reason about
// a package relative to its workspace (dead-exports, unused-deps) — not
// specific to either one.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export interface WorkspacePackage {
  name: string
  rootDir: string
  packageJson: Record<string, unknown>
}

export interface WorkspaceInfo {
  root: string
  packages: WorkspacePackage[]
}

function readPackageJson(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

// Only the one shape pnpm-workspace.yaml realistically uses in practice —
// a top-level `packages:` key followed by `- 'glob'` list items. Not a
// general YAML parser; anything fancier (anchors, nested maps) isn't
// recognized and the file is treated as if it weren't there.
function parsePnpmWorkspaceYaml(text: string): string[] {
  const lines = text.split('\n')
  const globs: string[] = []
  let inPackages = false
  for (const line of lines) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true
      continue
    }
    if (inPackages) {
      const item = line.match(/^\s*-\s*['"]?([^'"#]+)['"]?\s*(#.*)?$/)
      if (item) {
        globs.push((item[1] as string).trim())
        continue
      }
      if (/^\S/.test(line)) break // dedented past the packages: block
    }
  }
  return globs
}

function expandGlob(root: string, glob: string): string[] {
  // Only "dir/*" (one trailing wildcard segment) is supported — the
  // overwhelming common case for a workspace's packages list. A glob
  // without a wildcard is just a literal directory.
  if (!glob.includes('*')) {
    const dir = resolve(root, glob)
    return existsSync(dir) && statSync(dir).isDirectory() ? [dir] : []
  }
  const starIndex = glob.indexOf('*')
  const prefix = glob.slice(0, starIndex).replace(/\/$/, '')
  const parentDir = resolve(root, prefix)
  if (!existsSync(parentDir)) return []
  return readdirSync(parentDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(parentDir, e.name))
}

function packagesFromGlobs(root: string, globs: string[]): WorkspacePackage[] {
  const packages: WorkspacePackage[] = []
  for (const glob of globs) {
    for (const dir of expandGlob(root, glob)) {
      const pkgJson = readPackageJson(dir)
      const name = pkgJson && typeof pkgJson.name === 'string' ? pkgJson.name : null
      if (pkgJson && name) packages.push({ name, rootDir: dir, packageJson: pkgJson })
    }
  }
  return packages
}

/**
 * Walks up from `startDir` looking for a pnpm/npm/yarn workspace root.
 * Returns `null` if none is found — a plain single-package project.
 */
export function detectWorkspace(startDir: string): WorkspaceInfo | null {
  let dir = resolve(startDir)
  for (;;) {
    const pnpmWorkspacePath = join(dir, 'pnpm-workspace.yaml')
    if (existsSync(pnpmWorkspacePath)) {
      const globs = parsePnpmWorkspaceYaml(readFileSync(pnpmWorkspacePath, 'utf8'))
      return { root: dir, packages: packagesFromGlobs(dir, globs) }
    }

    const pkgJson = readPackageJson(dir)
    if (pkgJson?.workspaces) {
      const raw = pkgJson.workspaces
      const globs = Array.isArray(raw)
        ? (raw as unknown[]).filter((g): g is string => typeof g === 'string')
        : Array.isArray((raw as { packages?: unknown[] })?.packages)
          ? ((raw as { packages: unknown[] }).packages.filter(
              (g): g is string => typeof g === 'string',
            ) as string[])
          : []
      return { root: dir, packages: packagesFromGlobs(dir, globs) }
    }

    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}
