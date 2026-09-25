// Enumerates every file path `package.json` declares — main/module/types/
// typings/bin/exports — each tagged with WHERE it came from (e.g.
// `exports["./cdn"].types`), so a finding can point at the exact field to
// fix, not just "package.json is wrong somewhere".

export interface DeclaredPath {
  /** e.g. 'main', 'bin.devtoolz', 'exports["./cdn"].types' */
  location: string
  /** as written in package.json, e.g. './dist/index.js' */
  path: string
  /**
   * True when this entry came from inside a real conditions object (e.g.
   * `{ import: ..., require: ... }`), where a missing `types` sibling is a
   * genuine gap. False for a bare string/array subpath value, where there
   * are no siblings at all and TypeScript falls back to a colocated
   * `.d.ts` file instead — flagging those as "types missing" would be a
   * false positive.
   */
  isConditionEntry: boolean
}

function isConditionsObject(value: Record<string, unknown>): boolean {
  // An `exports` value is either a subpaths map (every key starts with
  // '.') or a conditions map for the implicit '.' entry (keys are
  // condition names like import/require/types/default/node/browser,
  // none starting with '.') — same heuristic Node/bundlers use.
  const keys = Object.keys(value)
  return keys.length > 0 && keys.every((k) => !k.startsWith('.'))
}

function walkExportsValue(
  value: unknown,
  exportsKey: string,
  conditionPath: string[],
  out: DeclaredPath[],
): void {
  if (typeof value === 'string') {
    const suffix = conditionPath.length > 0 ? `.${conditionPath.join('.')}` : ''
    out.push({
      location: `exports["${exportsKey}"]${suffix}`,
      path: value,
      isConditionEntry: conditionPath.length > 0,
    })
  } else if (Array.isArray(value)) {
    // A fallback array — any entry could be the one actually picked at
    // runtime depending on the consumer's environment, so all are checked.
    for (const entry of value) walkExportsValue(entry, exportsKey, conditionPath, out)
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      walkExportsValue(nested, exportsKey, [...conditionPath, key], out)
    }
  }
}

function collectExportsPaths(exportsField: unknown): DeclaredPath[] {
  const out: DeclaredPath[] = []
  if (typeof exportsField === 'string') {
    out.push({ location: 'exports', path: exportsField, isConditionEntry: false })
    return out
  }
  if (!exportsField || typeof exportsField !== 'object') return out

  if (isConditionsObject(exportsField as Record<string, unknown>)) {
    walkExportsValue(exportsField, '.', [], out)
  } else {
    for (const [subpath, value] of Object.entries(exportsField)) {
      walkExportsValue(value, subpath, [], out)
    }
  }
  return out
}

function collectBinPaths(binField: unknown): DeclaredPath[] {
  if (typeof binField === 'string')
    return [{ location: 'bin', path: binField, isConditionEntry: false }]
  if (binField && typeof binField === 'object') {
    return Object.entries(binField)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([name, path]) => ({ location: `bin.${name}`, path, isConditionEntry: false }))
  }
  return []
}

export function collectDeclaredPaths(pkg: Record<string, unknown>): DeclaredPath[] {
  const out: DeclaredPath[] = []
  for (const field of ['main', 'module', 'types', 'typings'] as const) {
    if (typeof pkg[field] === 'string')
      out.push({ location: field, path: pkg[field] as string, isConditionEntry: false })
  }
  out.push(...collectBinPaths(pkg.bin))
  out.push(...collectExportsPaths(pkg.exports))
  return out
}

/** `location`s that name a `bin` entry — these additionally need a shebang. */
export function isBinLocation(location: string): boolean {
  return location === 'bin' || location.startsWith('bin.')
}

/** `location`s that are the `types`/`typings` half of a pair — see core.ts's types-vs-runtime check. */
export function isTypesLocation(location: string): boolean {
  return location === 'types' || location === 'typings' || location.endsWith('.types')
}
