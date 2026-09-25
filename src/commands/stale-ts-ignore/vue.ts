import ts from 'typescript'
import { findTsIgnoreDirectives, type TsIgnoreDirective } from './core.js'

const SCRIPT_RE = /(<script[^>]*>)([\s\S]*?)(<\/script>)/

export interface VueScript {
  /** the <script> block's own text, starting right after the opening tag */
  body: string
  /** how many lines come before the block in the real .vue file */
  lineOffset: number
}

export function extractVueScript(text: string): VueScript | null {
  const match = text.match(SCRIPT_RE)
  if (!match) return null
  const [, , body] = match as [string, string, string, string]
  const lineOffset = (text.slice(0, match.index).match(/\n/g) ?? []).length
  return { body, lineOffset }
}

export function findVueTsIgnoreDirectives(body: string): TsIgnoreDirective[] {
  const sf = ts.createSourceFile('f.ts', body, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  return findTsIgnoreDirectives(body, sf)
}
