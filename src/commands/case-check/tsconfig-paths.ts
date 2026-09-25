// Resolves an aliased specifier (`@/components/Foo`) to a relative-style
// path (`../components/Foo`, from whichever file is asking) via
// `compilerOptions.paths`/`baseUrl` — only the common single-`*`-wildcard
// pattern shape is supported (`{"@/*": ["src/*"]}`), which covers the
// overwhelming majority of real projects; anything fancier (multiple
// fallback targets, non-wildcard exact aliases) is left unresolved rather
// than guessed at.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

export interface TsconfigPaths {
  baseDir: string
  /** each entry: the alias pattern's fixed prefix/suffix around its `*`, and its target template */
  patterns: Array<{ prefix: string; suffix: string; target: string }>
}

function stripJsonComments(text: string): string {
  // tsconfig.json commonly has // and /* */ comments (JSONC) — a real
  // parser isn't warranted for this narrow use, but plain JSON.parse
  // chokes on them. Strips comments outside of string literals only.
  let out = ''
  let inString = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += text[i + 1] ?? ''
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i++
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      i++
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += ch
    i++
  }
  return out
}

export function loadTsconfigPaths(tsconfigPath: string): TsconfigPaths | null {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(stripJsonComments(readFileSync(tsconfigPath, 'utf8'))) as Record<
      string,
      unknown
    >
  } catch {
    return null
  }

  const compilerOptions = raw.compilerOptions as Record<string, unknown> | undefined
  const pathsMap = compilerOptions?.paths as Record<string, unknown> | undefined
  if (!pathsMap) return null

  const tsconfigDir = dirname(tsconfigPath)
  const baseUrl = typeof compilerOptions?.baseUrl === 'string' ? compilerOptions.baseUrl : '.'
  const baseDir = resolve(tsconfigDir, baseUrl)

  const patterns: TsconfigPaths['patterns'] = []
  for (const [alias, targets] of Object.entries(pathsMap)) {
    if (!Array.isArray(targets) || typeof targets[0] !== 'string') continue
    const target = targets[0] as string
    const starIndex = alias.indexOf('*')
    if (starIndex === -1) continue // exact (non-wildcard) alias — out of scope, see file header
    patterns.push({
      prefix: alias.slice(0, starIndex),
      suffix: alias.slice(starIndex + 1),
      target,
    })
  }

  return patterns.length > 0 ? { baseDir, patterns } : null
}

export function findTsconfig(startDir: string): string | null {
  let dir = resolve(startDir)
  for (;;) {
    const candidate = join(dir, 'tsconfig.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Resolves an aliased specifier to a `./`/`../`-relative specifier as
 * seen from `fromFile`, or `null` if it doesn't match any configured
 * pattern. The result feeds straight into resolve-case.ts's relative-
 * specifier checker — same function, one caller resolves the alias
 * first.
 */
export function resolveAlias(
  fromFile: string,
  specifier: string,
  config: TsconfigPaths,
): string | null {
  for (const { prefix, suffix, target } of config.patterns) {
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue
    const wildcardValue = specifier.slice(prefix.length, specifier.length - suffix.length)
    if (wildcardValue.includes('*')) continue // ambiguous — more than one wildcard segment matched

    const targetStarIndex = target.indexOf('*')
    const resolvedTargetRel = targetStarIndex === -1 ? target : target.replace('*', wildcardValue)
    const absoluteTarget = resolve(config.baseDir, resolvedTargetRel)

    const rel = relative(dirname(fromFile), absoluteTarget).split('\\').join('/')
    return rel.startsWith('.') ? rel : `./${rel}`
  }
  return null
}
