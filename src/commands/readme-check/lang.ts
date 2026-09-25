import ts from 'typescript'

export interface LangInfo {
  scriptKind: ts.ScriptKind
  extension: string
  needsAllowJs: boolean
}

const LANG_MAP: Record<string, LangInfo> = {
  ts: { scriptKind: ts.ScriptKind.TS, extension: '.ts', needsAllowJs: false },
  typescript: { scriptKind: ts.ScriptKind.TS, extension: '.ts', needsAllowJs: false },
  tsx: { scriptKind: ts.ScriptKind.TSX, extension: '.tsx', needsAllowJs: false },
  js: { scriptKind: ts.ScriptKind.JS, extension: '.js', needsAllowJs: true },
  javascript: { scriptKind: ts.ScriptKind.JS, extension: '.js', needsAllowJs: true },
  jsx: { scriptKind: ts.ScriptKind.JSX, extension: '.jsx', needsAllowJs: true },
}

export function resolveLangInfo(lang: string): LangInfo | null {
  return LANG_MAP[lang] ?? null
}

// tsx is deliberately NOT in the default set — real-world dogfooding
// against every package in this workspace showed EVERY tsx block failing
// universally with "Cannot use JSX unless the '--jsx' flag is provided"
// (Vue packages don't configure JSX/React types, since the block is
// illustrative "if you're in a React app" pseudocode, not code this
// package could ever compile). Opt in explicitly with `--lang ts,tsx` for
// a package that actually configures JSX in its own tsconfig.
export const DEFAULT_LANGS = ['ts']
