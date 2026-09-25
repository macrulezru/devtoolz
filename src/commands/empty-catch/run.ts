import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { walk } from '../../utils/walk.js'
import { analyzeEmptyCatch, type EmptyCatchFinding } from './core.js'
import { analyzeEmptyCatchVue } from './vue.js'

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.vue']

export interface EmptyCatchRunOptions {
  paths: string[]
  cwd: string
  extensions?: string[]
  ignoreGlobs?: string[]
  respectGitignore?: boolean
}

export interface EmptyCatchFileFinding extends EmptyCatchFinding {
  file: string
}

export interface EmptyCatchReport {
  filesScanned: number
  findings: EmptyCatchFileFinding[]
  exitCode: number
}

export function runEmptyCatch(options: EmptyCatchRunOptions): EmptyCatchReport {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS
  const files = walk(options.paths, {
    cwd: options.cwd,
    extensions,
    ignoreGlobs: options.ignoreGlobs ?? [],
    ...(options.respectGitignore !== undefined
      ? { respectGitignore: options.respectGitignore }
      : {}),
  })

  const findings: EmptyCatchFileFinding[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const fileFindings = file.endsWith('.vue')
      ? analyzeEmptyCatchVue(text, file)
      : analyzeEmptyCatch(text, file)
    const relFile = relative(options.cwd, file).split('\\').join('/')
    for (const f of fileFindings) findings.push({ ...f, file: relFile })
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)

  return {
    filesScanned: files.length,
    findings,
    exitCode: findings.length > 0 ? 1 : 0,
  }
}
