import ts from 'typescript'

// TypeScript normalizes every file path it hands to a `CompilerHost` to
// forward slashes internally, even on Windows — matching against a
// `path`-built key (backslashes on win32) would silently never hit these
// overrides. Same gotcha `readme-check`'s own `typecheck.ts` documents.
export function normalize(fileName: string): string {
  return fileName.replace(/\\/g, '/')
}

/**
 * One real `ts.createProgram` run over `rootNames`, with `overrides`
 * (absolute path → replacement source text) substituted in for whichever
 * of those files it names — every other file resolves against the real
 * filesystem via `ts.createCompilerHost`. Returns every diagnostic
 * grouped by file and 1-based line, which is all `run.ts` ever needs:
 * whether SOME diagnostic landed on a specific line, not its message.
 */
export function runProjectTypecheck(
  rootNames: string[],
  options: ts.CompilerOptions,
  overrides?: Map<string, string>,
): Map<string, Set<number>> {
  const checkOptions: ts.CompilerOptions = { ...options, noEmit: true, skipLibCheck: true }
  const baseHost = ts.createCompilerHost(checkOptions)

  const host: ts.CompilerHost = overrides
    ? {
        ...baseHost,
        getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) {
          const override = overrides.get(normalize(fileName))
          if (override !== undefined) {
            const version =
              typeof languageVersionOrOptions === 'object'
                ? languageVersionOrOptions.languageVersion
                : languageVersionOrOptions
            return ts.createSourceFile(fileName, override, version, true)
          }
          return baseHost.getSourceFile(
            fileName,
            languageVersionOrOptions,
            onError,
            shouldCreateNewSourceFile,
          )
        },
        readFile(fileName) {
          const override = overrides.get(normalize(fileName))
          if (override !== undefined) return override
          return baseHost.readFile(fileName)
        },
      }
    : baseHost

  const program = ts.createProgram({ rootNames, options: checkOptions, host })
  const diagnostics = ts.getPreEmitDiagnostics(program)

  const byFile = new Map<string, Set<number>>()
  for (const d of diagnostics) {
    if (!d.file || d.start === undefined) continue
    const line = d.file.getLineAndCharacterOfPosition(d.start).line + 1
    const key = normalize(d.file.fileName)
    let lines = byFile.get(key)
    if (!lines) {
      lines = new Set()
      byFile.set(key, lines)
    }
    lines.add(line)
  }
  return byFile
}

/**
 * Typechecks a single piece of source IN ISOLATION, against the real
 * package's real types on disk (relative/self-referencing imports both
 * resolve normally) — same virtual-single-file technique as
 * `readme-check`'s `typecheckBlock`, reused here for `.vue` files, which
 * a plain `ts.Program` can't include in a whole-project run at all (no
 * SFC support without pulling in `vue-tsc`'s own machinery). This misses
 * diagnostics that would only appear from OTHER files' real usage of
 * this one — an accepted, documented gap, same class as `readme-check`'s
 * own isolated-block limitation.
 */
export function checkIsolatedFile(
  virtualFileName: string,
  code: string,
  baseOptions: ts.CompilerOptions,
): Set<number> {
  const options: ts.CompilerOptions = { ...baseOptions, noEmit: true, skipLibCheck: true }
  const baseHost = ts.createCompilerHost(options)
  const virtualSourceFile = ts.createSourceFile(
    virtualFileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )

  const host: ts.CompilerHost = {
    ...baseHost,
    getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) {
      if (fileName === virtualFileName) return virtualSourceFile
      return baseHost.getSourceFile(
        fileName,
        languageVersionOrOptions,
        onError,
        shouldCreateNewSourceFile,
      )
    },
    fileExists(fileName) {
      if (fileName === virtualFileName) return true
      return baseHost.fileExists(fileName)
    },
    readFile(fileName) {
      if (fileName === virtualFileName) return code
      return baseHost.readFile(fileName)
    },
    writeFile() {},
  }

  const program = ts.createProgram({ rootNames: [virtualFileName], options, host })
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName === virtualFileName)

  const lines = new Set<number>()
  for (const d of diagnostics) {
    if (d.start === undefined || !d.file) continue
    lines.add(d.file.getLineAndCharacterOfPosition(d.start).line + 1)
  }
  return lines
}
