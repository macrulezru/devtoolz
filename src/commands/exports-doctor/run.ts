import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkPackage, type ExportsDoctorFinding } from './core.js'

export interface ExportsDoctorRunOptions {
  /** package directory to check */
  dir: string
}

export interface ExportsDoctorReport {
  packageName: string | null
  findings: ExportsDoctorFinding[]
  /** package.json couldn't be read/parsed at all — a different kind of problem than any single finding */
  error: string | null
  exitCode: number
}

export function runExportsDoctor(options: ExportsDoctorRunOptions): ExportsDoctorReport {
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(readFileSync(join(options.dir, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >
  } catch (err) {
    return {
      packageName: null,
      findings: [],
      error: err instanceof Error ? err.message : String(err),
      exitCode: 1,
    }
  }

  const result = checkPackage(pkg, options.dir)

  return {
    packageName: result.packageName,
    findings: result.findings,
    error: null,
    exitCode: result.findings.length > 0 ? 1 : 0,
  }
}
