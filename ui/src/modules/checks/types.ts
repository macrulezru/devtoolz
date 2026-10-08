export type Severity = 'error' | 'warning' | 'info'

export interface CheckFinding {
  file?: string
  line?: number
  column?: number
  severity: Severity
  code: string
  message: string
  hint?: string
  files?: string[]
}

export interface CheckOption {
  key: string
  label: string
  type: 'boolean' | 'list'
  default: boolean | string
  help: string
}

export interface CheckInfo {
  id: string
  title: string
  description: string
  group: 'dependencies' | 'code' | 'docs'
  slow: boolean
  options: CheckOption[]
}

export interface CheckOutcome {
  summary: string
  filesScanned?: number
  findings: CheckFinding[]
  error?: string
  exitCode: number
  notes?: string[]
  project: string
  check: string
  tookMs: number
}

export interface SourceFile {
  path: string
  abs: string
  lang: string
  lines: number
  text: string
}

export type OptionValues = Record<string, boolean | string>

export function defaultOptions(check: CheckInfo): OptionValues {
  return Object.fromEntries(check.options.map((option) => [option.key, option.default]))
}
