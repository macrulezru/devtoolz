import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { loadTsconfig } from '../../utils/load-tsconfig.js'
import { walk } from '../../utils/walk.js'
import { findTsIgnoreDirectives, blankDirectives, type TsIgnoreDirective } from './core.js'
import { extractVueScript, findVueTsIgnoreDirectives } from './vue.js'
import { runProjectTypecheck, checkIsolatedFile, normalize } from './check.js'

export interface StaleTsIgnoreRunOptions {
  /** package directory to check — where tsconfig.json is auto-detected from, and .vue files are walked under */
  dir: string
  /** tsconfig.json path, relative to `dir` — auto-detected by default */
  tsconfig?: string
  ignoreGlobs?: string[]
  respectGitignore?: boolean
  /** called once, only when there's real typecheck work to do — a large project can take a while */
  onProgress?: (message: string) => void
}

export interface StaleTsIgnoreFinding {
  file: string
  /** 1-based line the `// @ts-ignore` comment itself sits on */
  line: number
}

export interface StaleTsIgnoreReport {
  directivesChecked: number
  findings: StaleTsIgnoreFinding[]
  /** no tsconfig.json found, or it failed to parse — a different kind of problem than any single finding */
  error: string | null
  exitCode: number
}

function scriptKindFor(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs'))
    return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

export function runStaleTsIgnore(options: StaleTsIgnoreRunOptions): StaleTsIgnoreReport {
  const packageDir = resolve(options.dir)

  const loaded = loadTsconfig(packageDir, options.tsconfig)
  if ('error' in loaded) {
    return { directivesChecked: 0, findings: [], error: loaded.error, exitCode: 1 }
  }

  const tsFiles = new Map<string, { text: string; directives: TsIgnoreDirective[] }>()
  for (const fileName of loaded.fileNames) {
    let text: string
    try {
      text = readFileSync(fileName, 'utf8')
    } catch {
      continue
    }
    const sf = ts.createSourceFile(
      fileName,
      text,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(fileName),
    )
    const directives = findTsIgnoreDirectives(text, sf)
    if (directives.length > 0) tsFiles.set(normalize(fileName), { text, directives })
  }

  const vueFiles = new Map<
    string,
    { body: string; lineOffset: number; directives: TsIgnoreDirective[] }
  >()
  for (const absFile of walk(['.'], {
    cwd: packageDir,
    extensions: ['.vue'],
    ignoreGlobs: options.ignoreGlobs ?? [],
    ...(options.respectGitignore !== undefined
      ? { respectGitignore: options.respectGitignore }
      : {}),
  })) {
    const text = readFileSync(absFile, 'utf8')
    const script = extractVueScript(text)
    if (!script) continue
    const directives = findVueTsIgnoreDirectives(script.body)
    if (directives.length > 0) {
      vueFiles.set(absFile, { body: script.body, lineOffset: script.lineOffset, directives })
    }
  }

  const directivesChecked =
    [...tsFiles.values()].reduce((n, f) => n + f.directives.length, 0) +
    [...vueFiles.values()].reduce((n, f) => n + f.directives.length, 0)

  if (directivesChecked === 0) {
    return { directivesChecked: 0, findings: [], error: null, exitCode: 0 }
  }

  options.onProgress?.(
    'Running a project-wide typecheck, twice — this can take a while on a large project…',
  )

  const findings: StaleTsIgnoreFinding[] = []

  if (tsFiles.size > 0) {
    const before = runProjectTypecheck(loaded.fileNames, loaded.options)
    const overrides = new Map<string, string>()
    for (const [key, { text, directives }] of tsFiles) {
      overrides.set(key, blankDirectives(text, directives))
    }
    const after = runProjectTypecheck(loaded.fileNames, loaded.options, overrides)

    for (const [key, { directives }] of tsFiles) {
      for (const d of directives) {
        const wasAlreadyThere = before.get(key)?.has(d.targetLine) ?? false
        const appearedAfterBlanking = after.get(key)?.has(d.targetLine) ?? false
        if (appearedAfterBlanking && !wasAlreadyThere) continue
        findings.push({ file: relative(packageDir, key).split('\\').join('/'), line: d.line })
      }
    }
  }

  for (const [absFile, { body, lineOffset, directives }] of vueFiles) {
    const virtualFileName = normalize(join(dirname(absFile), '__devtoolz_stale_ts_ignore__.ts'))
    const before = checkIsolatedFile(virtualFileName, body, loaded.options)
    const after = checkIsolatedFile(
      virtualFileName,
      blankDirectives(body, directives),
      loaded.options,
    )

    for (const d of directives) {
      if (after.has(d.targetLine) && !before.has(d.targetLine)) continue
      findings.push({
        file: relative(packageDir, absFile).split('\\').join('/'),
        line: d.line + lineOffset,
      })
    }
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)

  return {
    directivesChecked,
    findings,
    error: null,
    exitCode: findings.length > 0 ? 1 : 0,
  }
}
