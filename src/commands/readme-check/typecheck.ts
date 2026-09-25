import ts from 'typescript'
import { join } from 'node:path'
import { resolveLangInfo } from './lang.js'

export interface BlockDiagnostic {
  /** 0-based line WITHIN the block's own code, matches ts.LineAndCharacter */
  line: number
  character: number
  message: string
  category: 'error' | 'warning'
  /** TS diagnostic code, e.g. 2304 for "Cannot find name" — lets a caller filter by known-noisy codes */
  code: number
}

/**
 * Typechecks one code block in complete isolation against the target
 * package's real types — no code is ever executed, only compiled. The
 * block is presented to the compiler as a virtual file sitting AT THE
 * PACKAGE ROOT (same directory as package.json), which is what lets both
 * relative imports (`./dist/foo`) and self-referencing package-name
 * imports (`import { x } from '@scope/this-same-package'`) resolve
 * exactly as they would for a real consumer — Node/TS's self-reference
 * resolution walks up from the importing FILE's real directory looking
 * for the nearest package.json, and that lookup hits the real one on
 * disk since only `getSourceFile`/`fileExists`/`readFile` are overridden
 * for the single virtual path; everything else delegates to the real
 * filesystem via `ts.createCompilerHost`.
 *
 * Returns null when `lang` isn't a checkable language (block is skipped
 * upstream), otherwise the list of diagnostics raised for THIS file only
 * — diagnostics whose `file` is some OTHER file pulled into the module
 * graph (e.g. a real type error inside the package's own .d.ts) are not
 * this block's fault and are filtered out.
 */
export function typecheckBlock(
  code: string,
  lang: string,
  packageDir: string,
  baseOptions: ts.CompilerOptions,
): BlockDiagnostic[] | null {
  const langInfo = resolveLangInfo(lang)
  if (!langInfo) return null

  // TypeScript normalizes every file path it works with to forward
  // slashes internally, even on Windows — comparing against a
  // `path.join`-built name (backslashes on win32) would never match what
  // the compiler actually passes back into `getSourceFile`/`fileExists`,
  // silently turning every block into a false "file not found", 0
  // diagnostics ever produced. Caught by an isolated repro against a real
  // package before writing tests, not by the tests themselves.
  const virtualFileName = join(
    packageDir,
    `__devtoolz_readme_check__${langInfo.extension}`,
  ).replace(/\\/g, '/')
  const options: ts.CompilerOptions = {
    ...baseOptions,
    noEmit: true,
    skipLibCheck: true,
    ...(langInfo.needsAllowJs ? { allowJs: true, checkJs: true } : {}),
  }

  const baseHost = ts.createCompilerHost(options)
  const virtualSourceFile = ts.createSourceFile(
    virtualFileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    langInfo.scriptKind,
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
    writeFile() {
      // noEmit is always forced above — never actually called, kept as a safe no-op
    },
  }

  const program = ts.createProgram({ rootNames: [virtualFileName], options, host })
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName === virtualFileName)

  return diagnostics.map((d) => {
    const pos =
      d.file && d.start !== undefined
        ? d.file.getLineAndCharacterOfPosition(d.start)
        : { line: 0, character: 0 }
    return {
      line: pos.line,
      character: pos.character,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      category: d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
      code: d.code,
    }
  })
}
