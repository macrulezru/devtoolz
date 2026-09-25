import { readFileSync } from 'node:fs'
import { analyzeFile } from '../../utils/parse-module.js'
import { packageNameFromSpecifier } from './package-name.js'
import { declaredBinNames, resolvePackageDir } from './disk-resolve.js'
import { readConfigFilesText, textReferencesPackage } from './config-files.js'

const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const
type DependencySection = (typeof DEPENDENCY_SECTIONS)[number]

export interface UnusedDepsFinding {
  kind: 'unused' | 'phantom'
  name: string
  /** which package.json section an 'unused' finding was declared in */
  section?: DependencySection
  /** where a 'phantom' finding actually resolved from on disk */
  resolvedFrom?: string
}

export interface UnusedDepsAnalysis {
  findings: UnusedDepsFinding[]
  filesAnalyzed: number
}

export interface AnalyzeOptions {
  packageDir: string
  pkg: Record<string, unknown>
  /** also check packages that are structurally undetectable as "used" by any means this command can see. default false */
  strict: boolean
  ignorePackages: Set<string>
  /** names of sibling packages in the same workspace — used-but-undeclared is expected for these, never "phantom" */
  workspacePackageNames: Set<string>
}

// Packages that are near-universally legitimate to have installed
// without ever appearing as an `import`, a script token, or even a
// string in a config file — either genuinely ambient (`@types/*`, picked
// up by TypeScript automatically) or inferred from a config VALUE by a
// tool's own naming convention rather than written out in full
// (`coverage: { provider: 'v8' }` in a vitest config makes vitest
// require `@vitest/coverage-v8` itself — the full package name is never
// actually written anywhere a text scan could find it). `--strict`
// checks these too, for a manual audit.
function isStructurallyImplicit(name: string): boolean {
  return (
    name.startsWith('@types/') ||
    name === 'typescript' ||
    name.startsWith('@vitest/coverage-') ||
    name === '@vitest/ui' ||
    // Ambient type augmentation for a Nuxt module's own config/types
    // (`defineNuxtConfig`, module hooks) — never imported by name,
    // same structural class as @types/*.
    name === '@nuxt/schema' ||
    // Vite's CSS preprocessors — auto-detected by file EXTENSION
    // (a `.scss` import triggers Vite to require `sass` if it's
    // installed) and postcss by config file PRESENCE, neither ever
    // spelled out by name in the project's own files. Confirmed
    // against two real, independent packages before adding this —
    // not a guess.
    name === 'postcss' ||
    name === 'sass' ||
    name === 'less' ||
    name === 'stylus'
  )
}

function tokenAppearsIn(values: string[], token: string): boolean {
  const words = values.flatMap((s) => s.split(/\s+/))
  return words.some((w) => w === token || w.endsWith(`/${token}`) || w.endsWith(`\\${token}`))
}

/**
 * A dependency invoked only by its bin name from tooling config embedded
 * directly in package.json (`scripts`, and `lint-staged` — commonly
 * inlined there rather than its own file) counts as used, same as an
 * import. Checked by the package's own name AND (if installed) its
 * declared `bin` keys, since `tsc`/`vitest`/`eslint` etc. don't always
 * match their package name.
 */
function usedViaPackageJsonTooling(
  pkg: Record<string, unknown>,
  packageDir: string,
  name: string,
): boolean {
  const scripts =
    pkg.scripts && typeof pkg.scripts === 'object'
      ? Object.values(pkg.scripts as Record<string, string>)
      : []
  const lintStaged =
    pkg['lint-staged'] && typeof pkg['lint-staged'] === 'object'
      ? Object.values(pkg['lint-staged'] as Record<string, unknown>).flatMap((v) =>
          Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : [],
        )
      : []
  const values = [...scripts, ...lintStaged]

  if (tokenAppearsIn(values, name)) return true
  return declaredBinNames(packageDir, name).some((bin) => tokenAppearsIn(values, bin))
}

export function analyzeUnusedDeps(files: string[], options: AnalyzeOptions): UnusedDepsAnalysis {
  const usedPackageNames = new Set<string>()

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const analysis = analyzeFile(text, file)
    for (const imp of analysis.imports) {
      const name = packageNameFromSpecifier(imp.from)
      if (name) usedPackageNames.add(name)
    }
  }

  const declared = new Map<string, DependencySection>()
  const allDeclaredNames = new Set<string>()
  for (const section of DEPENDENCY_SECTIONS) {
    const value = options.pkg[section]
    if (!value || typeof value !== 'object') continue
    for (const name of Object.keys(value as Record<string, unknown>)) {
      declared.set(name, section)
      allDeclaredNames.add(name)
    }
  }
  const peerDeps =
    options.pkg.peerDependencies && typeof options.pkg.peerDependencies === 'object'
      ? Object.keys(options.pkg.peerDependencies as Record<string, unknown>)
      : []
  for (const name of peerDeps) allDeclaredNames.add(name)

  // A package importing itself by its own published name (the same
  // self-reference readme-check resolves) is never a phantom dependency
  // — it can't sensibly be its own devDependency, so it's exempted
  // explicitly rather than expected to appear in package.json at all.
  if (typeof options.pkg.name === 'string') allDeclaredNames.add(options.pkg.name)

  const configText = readConfigFilesText(options.packageDir)

  const findings: UnusedDepsFinding[] = []

  for (const [name, section] of declared) {
    if (usedPackageNames.has(name)) continue
    if (options.ignorePackages.has(name)) continue
    if (!options.strict && isStructurallyImplicit(name)) continue
    if (usedViaPackageJsonTooling(options.pkg, options.packageDir, name)) continue
    if (textReferencesPackage(configText, name)) continue
    findings.push({ kind: 'unused', name, section })
  }

  for (const name of usedPackageNames) {
    if (allDeclaredNames.has(name)) continue
    if (options.ignorePackages.has(name)) continue
    if (options.workspacePackageNames.has(name)) continue
    const resolvedFrom = resolvePackageDir(options.packageDir, name)
    if (resolvedFrom) findings.push({ kind: 'phantom', name, resolvedFrom })
  }

  return { findings, filesAnalyzed: files.length }
}
