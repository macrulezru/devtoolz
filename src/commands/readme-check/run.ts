import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkMarkdownFile, type ReadmeCheckFinding, type ReadmeCheckFileResult } from './core.js'
import { loadCompilerOptions } from './tsconfig.js'
import { DEFAULT_LANGS } from './lang.js'

export interface ReadmeCheckRunOptions {
  /** package directory to check against */
  dir: string
  /** markdown files to check, relative to `dir` — default: ['README.md'] */
  files?: string[]
  /** fenced-block languages to typecheck — default: ['ts', 'tsx'] */
  langs?: string[]
  /** tsconfig.json path, relative to `dir` — auto-detected by default */
  tsconfig?: string
}

export interface ReadmeCheckReport {
  fileResults: ReadmeCheckFileResult[]
  findings: ReadmeCheckFinding[]
  /** couldn't load a tsconfig or read a target file at all — a different kind of problem than any single finding */
  error: string | null
  exitCode: number
}

export function runReadmeCheck(options: ReadmeCheckRunOptions): ReadmeCheckReport {
  const packageDir = resolve(options.dir)
  const targetFiles = options.files && options.files.length > 0 ? options.files : ['README.md']
  const langs = options.langs && options.langs.length > 0 ? options.langs : DEFAULT_LANGS

  const loaded = loadCompilerOptions(packageDir, options.tsconfig)
  if ('error' in loaded) {
    return { fileResults: [], findings: [], error: loaded.error, exitCode: 1 }
  }

  const fileResults: ReadmeCheckFileResult[] = []
  for (const relFile of targetFiles) {
    const absPath = resolve(packageDir, relFile)
    let markdown: string
    try {
      markdown = readFileSync(absPath, 'utf8')
    } catch (err) {
      return {
        fileResults: [],
        findings: [],
        error: `could not read ${relFile}: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: 1,
      }
    }
    fileResults.push(checkMarkdownFile(relFile, markdown, packageDir, loaded.options, langs))
  }

  const findings = fileResults.flatMap((f) => f.findings)
  return { fileResults, findings, error: null, exitCode: findings.length > 0 ? 1 : 0 }
}
