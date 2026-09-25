import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { escapeRegExp } from '../../utils/escape-regexp.js'

// Config files commonly reference a dependency by name — a vitest.config.ts's
// `environment: 'happy-dom'` (a quoted string), a postcss.config.js's
// `plugins: { autoprefixer: {} }` (a bare object key), never a JS
// `import`. No import-statement parse can see either shape; this is a
// deliberately narrow, explicit-filename text scan instead of guessing
// at every possible config format. Only the package root is checked
// (not recursive) — the overwhelming common location for all of these
// in a real project.
const CONFIG_FILENAMES = [
  'vitest.config.ts',
  'vitest.config.js',
  'vitest.config.mts',
  'vitest.config.mjs',
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mts',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.ts',
  '.stylelintrc',
  '.stylelintrc.json',
  '.stylelintrc.js',
  'stylelint.config.js',
  'stylelint.config.mjs',
  'postcss.config.js',
  'postcss.config.cjs',
  'postcss.config.mjs',
  'nuxt.config.ts',
  'tsconfig.json',
  'tsconfig.build.json',
]

export function readConfigFilesText(packageDir: string): string {
  const chunks: string[] = []
  for (const filename of CONFIG_FILENAMES) {
    const path = join(packageDir, filename)
    if (!existsSync(path)) continue
    try {
      chunks.push(readFileSync(path, 'utf8'))
    } catch {
      // unreadable — skip rather than fail the whole command over one config file
    }
  }
  return chunks.join('\n')
}

/**
 * Whether `name` appears as its own token anywhere in `text` — either
 * quoted (`extends: 'stylelint-config-standard'`) or a bare identifier
 * (`plugins: { autoprefixer: {} }`). Bounded on both sides so a
 * different package that merely contains `name` as a substring
 * (`autoprefixer-wrapper`, `@scope/autoprefixer`) doesn't count.
 */
export function textReferencesPackage(text: string, name: string): boolean {
  const pattern = new RegExp(`(?<![\\w@./-])${escapeRegExp(name)}(?![\\w-])`)
  return pattern.test(text)
}
