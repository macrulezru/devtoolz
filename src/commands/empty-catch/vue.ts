import { analyzeEmptyCatch, type EmptyCatchFinding } from './core.js'

const SCRIPT_RE = /(<script[^>]*>)([\s\S]*?)(<\/script>)/

export function analyzeEmptyCatchVue(text: string, file: string): EmptyCatchFinding[] {
  const scriptMatch = text.match(SCRIPT_RE)
  if (!scriptMatch) return []

  const [, , body] = scriptMatch as [string, string, string, string]
  const findings = analyzeEmptyCatch(body as string, file.replace(/\.vue$/, '.ts'))

  // Finding line numbers are relative to the <script> body alone (that's
  // all core.ts ever sees) — offset by however many lines come before it
  // in the real file, so a report against the whole .vue file points at
  // the right line.
  const lineOffset = (text.slice(0, scriptMatch.index).match(/\n/g) ?? []).length
  return findings.map((f) => ({ ...f, line: f.line + lineOffset }))
}
