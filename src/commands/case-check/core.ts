import { findSpecifiers } from './parse.js'
import { findSpecifiersInVue } from './vue.js'
import { checkSpecifierCase } from './resolve-case.js'
import { resolveAlias, type TsconfigPaths } from './tsconfig-paths.js'

export interface CaseCheckFinding {
  specifier: string
  correctedSpecifier: string
  /**
   * true for a specifier resolved through a tsconfig path alias — its
   * `correctedSpecifier` is shown in resolved relative form (there's no
   * reliable way back to an alias-shaped fix, see tsconfig-paths.ts), so
   * it's reported but never rewritten by --fix, only relative ones are.
   */
  isAlias: boolean
  start: number
  end: number
  line: number
  column: number
}

export function checkFile(
  text: string,
  file: string,
  paths: TsconfigPaths | null,
): CaseCheckFinding[] {
  const occurrences = file.endsWith('.vue')
    ? findSpecifiersInVue(text, file)
    : findSpecifiers(text, file)
  const findings: CaseCheckFinding[] = []

  for (const occ of occurrences) {
    if (occ.specifier.startsWith('.')) {
      const result = checkSpecifierCase(file, occ.specifier)
      if (result) {
        findings.push({
          specifier: occ.specifier,
          correctedSpecifier: result.correctedSpecifier,
          isAlias: false,
          start: occ.start,
          end: occ.end,
          line: occ.line,
          column: occ.column,
        })
      }
      continue
    }

    if (!paths) continue
    const relativeForm = resolveAlias(file, occ.specifier, paths)
    if (!relativeForm) continue
    const result = checkSpecifierCase(file, relativeForm)
    if (result) {
      findings.push({
        specifier: occ.specifier,
        correctedSpecifier: result.correctedSpecifier,
        isAlias: true,
        start: occ.start,
        end: occ.end,
        line: occ.line,
        column: occ.column,
      })
    }
  }

  return findings
}
