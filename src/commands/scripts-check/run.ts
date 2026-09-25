import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import {
  analyzeScriptsCheck,
  maskOutOfScopeCiSteps,
  type ScriptsCheckFinding,
  type ScriptSource,
} from './core.js'

export interface ScriptsCheckRunOptions {
  /** package directory to check — package.json, --file docs, and .github/workflows are all resolved from here */
  dir: string
  /** markdown/doc files to check, relative to `dir` — default: ['README.md'] */
  files?: string[]
}

export interface ScriptsCheckReport {
  findings: ScriptsCheckFinding[]
  sourcesScanned: string[]
  /** package.json or an explicitly-requested doc file couldn't be read at all — a different kind of problem than any single finding */
  error: string | null
  exitCode: number
}

function readWorkflowSources(packageDir: string): ScriptSource[] {
  let entries: string[]
  try {
    entries = readdirSync(join(packageDir, '.github', 'workflows'))
  } catch {
    return []
  }

  const sources: ScriptSource[] = []
  for (const entry of entries) {
    if (!/\.ya?ml$/.test(entry)) continue
    const relFile = `.github/workflows/${entry}`
    try {
      const text = maskOutOfScopeCiSteps(readFileSync(join(packageDir, relFile), 'utf8'))
      sources.push({ file: relFile, text })
    } catch {
      // unreadable — skip rather than fail the whole command over one file
    }
  }
  return sources
}

export function runScriptsCheck(options: ScriptsCheckRunOptions): ScriptsCheckReport {
  const packageDir = resolve(options.dir)

  let packageJsonText: string
  try {
    packageJsonText = readFileSync(join(packageDir, 'package.json'), 'utf8')
  } catch (err) {
    return {
      findings: [],
      sourcesScanned: [],
      error: `could not read package.json: ${err instanceof Error ? err.message : String(err)}`,
      exitCode: 1,
    }
  }

  let pkg: { scripts?: Record<string, string> }
  try {
    pkg = JSON.parse(packageJsonText) as { scripts?: Record<string, string> }
  } catch (err) {
    return {
      findings: [],
      sourcesScanned: [],
      error: `could not parse package.json: ${err instanceof Error ? err.message : String(err)}`,
      exitCode: 1,
    }
  }

  const scripts = pkg.scripts ?? {}
  const docFiles = options.files && options.files.length > 0 ? options.files : ['README.md']

  const sources: ScriptSource[] = []
  for (const relFile of docFiles) {
    let text: string
    try {
      text = readFileSync(join(packageDir, relFile), 'utf8')
    } catch (err) {
      return {
        findings: [],
        sourcesScanned: [],
        error: `could not read ${relFile}: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: 1,
      }
    }
    sources.push({ file: relFile, text })
  }
  sources.push(...readWorkflowSources(packageDir))

  const findings = analyzeScriptsCheck(scripts, 'package.json', packageJsonText, sources)
  findings.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))

  return {
    findings,
    sourcesScanned: sources.map((s) => s.file),
    error: null,
    exitCode: findings.length > 0 ? 1 : 0,
  }
}
