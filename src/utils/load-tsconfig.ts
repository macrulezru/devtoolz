import ts from 'typescript'
import { dirname, resolve } from 'node:path'

export interface LoadedTsconfig {
  options: ts.CompilerOptions
  /** every source file the project's tsconfig resolves to — absolute paths */
  fileNames: string[]
  configPath: string
}

export type LoadTsconfigResult = LoadedTsconfig | { error: string }

/**
 * Resolves a real `ts.CompilerOptions` (plus the project's real file
 * list) the way `tsc` itself would — auto-detecting `tsconfig.json` via
 * `ts.findConfigFile`, or an explicit override. Shared by `readme-check`
 * (only ever needs `options`, to typecheck one virtual file) and
 * `stale-ts-ignore` (needs `fileNames` too, for a real whole-project
 * typecheck) — extracted the moment the second consumer needed it, same
 * as the rest of this project's shared infra.
 */
export function loadTsconfig(packageDir: string, tsconfigOverride?: string): LoadTsconfigResult {
  const configPath = tsconfigOverride
    ? resolve(packageDir, tsconfigOverride)
    : ts.findConfigFile(packageDir, ts.sys.fileExists, 'tsconfig.json')

  if (!configPath || !ts.sys.fileExists(configPath)) {
    return { error: `no tsconfig.json found under ${packageDir}` }
  }

  const read = ts.readConfigFile(configPath, ts.sys.readFile)
  if (read.error) {
    return { error: ts.flattenDiagnosticMessageText(read.error.messageText, '\n') }
  }

  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath))
  if (parsed.errors.length > 0) {
    return {
      error: parsed.errors
        .map((e) => ts.flattenDiagnosticMessageText(e.messageText, '\n'))
        .join('\n'),
    }
  }

  return { options: parsed.options, fileNames: parsed.fileNames, configPath }
}
