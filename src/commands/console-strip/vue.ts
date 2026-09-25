import ts from 'typescript'
import { stripConsole, type SkippedCall, type StripConsoleOptions } from './core.js'

const SCRIPT_RE = /(<script[^>]*>)([\s\S]*?)(<\/script>)/

export interface StripConsoleVueResult {
  text: string
  changed: boolean
  count: number
  skipped: SkippedCall[]
}

export function stripConsoleVue(
  text: string,
  options: StripConsoleOptions = {},
): StripConsoleVueResult {
  const scriptMatch = text.match(SCRIPT_RE)
  if (!scriptMatch) return { text, changed: false, count: 0, skipped: [] }

  const [whole, open, body, close] = scriptMatch as [string, string, string, string]
  const result = stripConsole(body, { ...options, scriptKind: ts.ScriptKind.TS })
  if (!result.changed && result.skipped.length === 0) {
    return { text, changed: false, count: 0, skipped: [] }
  }

  // Skipped-entry line numbers are relative to the <script> body alone
  // (that's all core.ts ever sees) — offset by however many lines come
  // before it in the real file, so a report against the whole .vue file
  // points at the right line.
  const lineOffset = (text.slice(0, scriptMatch.index).match(/\n/g) ?? []).length
  const skipped = result.skipped.map((s) => ({ ...s, line: s.line + lineOffset }))

  if (!result.changed) return { text, changed: false, count: 0, skipped }

  const newText =
    text.slice(0, scriptMatch.index) +
    open +
    result.text +
    close +
    text.slice(scriptMatch.index! + whole.length)
  return { text: newText, changed: true, count: result.count, skipped }
}
