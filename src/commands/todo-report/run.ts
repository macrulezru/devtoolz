import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { walk } from '../../utils/walk.js'
import { analyzeTodoReport, DEFAULT_TAGS, type TodoFinding } from './core.js'
import { analyzeTodoReportVue } from './vue.js'

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.vue']

export interface TodoReportRunOptions {
  paths: string[]
  cwd: string
  extensions?: string[]
  ignoreGlobs?: string[]
  respectGitignore?: boolean
  tags?: string[]
  /** don't fail (exit 1) unless findings exceed this count — a ratchet for projects living with existing debt */
  max?: number
}

export interface TodoFileFinding extends TodoFinding {
  file: string
}

export interface TodoReportReport {
  filesScanned: number
  findings: TodoFileFinding[]
  countsByTag: Record<string, number>
  max: number
  exitCode: number
}

export function runTodoReport(options: TodoReportRunOptions): TodoReportReport {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS
  const tags = options.tags ?? DEFAULT_TAGS
  const max = options.max ?? 0
  const files = walk(options.paths, {
    cwd: options.cwd,
    extensions,
    ignoreGlobs: options.ignoreGlobs ?? [],
    ...(options.respectGitignore !== undefined
      ? { respectGitignore: options.respectGitignore }
      : {}),
  })

  const findings: TodoFileFinding[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const fileFindings = file.endsWith('.vue')
      ? analyzeTodoReportVue(text, file, tags)
      : analyzeTodoReport(text, file, tags)
    const relFile = relative(options.cwd, file).split('\\').join('/')
    for (const f of fileFindings) findings.push({ ...f, file: relFile })
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)

  const countsByTag: Record<string, number> = {}
  for (const f of findings) countsByTag[f.tag] = (countsByTag[f.tag] ?? 0) + 1

  return {
    filesScanned: files.length,
    findings,
    countsByTag,
    max,
    exitCode: findings.length > max ? 1 : 0,
  }
}
