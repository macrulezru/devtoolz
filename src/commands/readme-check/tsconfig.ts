import ts from 'typescript'
import { dirname, resolve } from 'node:path'

export interface LoadedCompilerOptions {
  options: ts.CompilerOptions
  configPath: string
}

export type LoadCompilerOptionsResult = LoadedCompilerOptions | { error: string }

export function loadCompilerOptions(
  packageDir: string,
  tsconfigOverride?: string,
): LoadCompilerOptionsResult {
  const configPath = tsconfigOverride
    ? resolve(packageDir, tsconfigOverride)
    : ts.findConfigFile(packageDir, ts.sys.fileExists, 'tsconfig.json')

  if (!configPath || !ts.sys.fileExists(configPath)) {
    return {
      error: `no tsconfig.json found under ${packageDir} — nothing to typecheck README code blocks against`,
    }
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

  return { options: parsed.options, configPath }
}
