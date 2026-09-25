import { isBuiltin } from 'node:module'

/**
 * Extracts the real npm package name a bare import specifier resolves
 * to — `lodash/debounce` -> `lodash`, `@scope/name/sub/path` ->
 * `@scope/name`. Returns null for a relative/absolute specifier or a
 * Node builtin (`fs`, `node:fs`) — neither is ever a real dependency of
 * this project.
 */
export function packageNameFromSpecifier(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null
  if (isBuiltin(specifier)) return null

  const parts = specifier.split('/')
  if (specifier.startsWith('@')) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null
  }
  return parts[0] ?? null
}
