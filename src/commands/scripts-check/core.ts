import { escapeRegExp } from '../../utils/escape-regexp.js'
import { lineOf } from '../../utils/line-of.js'

export interface ScriptsCheckFinding {
  kind: 'missing' | 'undocumented'
  name: string
  file: string
  line: number
}

export interface ScriptSource {
  file: string
  text: string
}

// npm's own no-`run`-needed aliases — the ONLY bare `npm <word>` forms
// that unambiguously mean "run this script". Any other bare word after
// `npm` is a real npm subcommand (`npm install`, `npm publish`, ...), not
// a script invocation.
const NPM_BARE_ALIASES = new Set(['test', 'start'])

// Forms unambiguous enough to EXTRACT an arbitrary script name from —
// each requires an explicit `run`/`run-script`, or is one of npm's own
// bare aliases above, so there's no risk of misreading an unrelated
// subcommand (`yarn add`, `pnpm install`) as a script name. Used for
// direction 1 (finding a mention of a script that doesn't exist).
const EXTRACT_PATTERNS = [
  /\bnpm\s+run(?:-script)?\s+([\w:./@-]+)/g,
  /\byarn\s+run\s+([\w:./@-]+)/g,
  /\bpnpm\s+run\s+([\w:./@-]+)/g,
  /\b(?:npm|yarn|pnpm)\s+(test|start)\b/g,
]

// A GitHub Actions step with its own `working-directory:` runs against a
// DIFFERENT package.json (a `demo/` subproject, a workspace package) —
// found for real while dogfooding against vue-virtual-scroller-kit: its
// `e2e` job runs `npm run test:e2e` under `working-directory: demo`,
// where that script genuinely exists in `demo/package.json`, but not in
// the root one this command checks. No real YAML parsing here (same
// text-scan-not-AST spirit as everything else in this command) — a step
// boundary is approximated as everything within a few lines of a
// `working-directory:` line, which is blanked out (same length, so line
// numbers for anything NOT blanked stay correct) before either direction
// gets to look at it.
const WORKING_DIRECTORY_RE = /^\s*working-directory\s*:/
const STEP_SCOPE_WINDOW = 3

export function maskOutOfScopeCiSteps(text: string): string {
  const lines = text.split('\n')
  const hasWorkingDir = lines.map((l) => WORKING_DIRECTORY_RE.test(l))
  if (!hasWorkingDir.some(Boolean)) return text

  return lines
    .map((line, i) => {
      const start = Math.max(0, i - STEP_SCOPE_WINDOW)
      const end = Math.min(lines.length - 1, i + STEP_SCOPE_WINDOW)
      for (let j = start; j <= end; j++) {
        if (hasWorkingDir[j]) return line.replace(/./g, 'x')
      }
      return line
    })
    .join('\n')
}

export function extractMentionedScripts(text: string): { name: string; index: number }[] {
  const mentions: { name: string; index: number }[] = []
  for (const pattern of EXTRACT_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text))) {
      mentions.push({ name: match[1] as string, index: match.index })
    }
  }
  return mentions
}

// Direction 2 (is an ALREADY-KNOWN script name mentioned anywhere) can
// afford to also accept yarn/pnpm's own bare `<manager> <name>` form —
// real for those two package managers, unlike plain npm — since we're
// testing one specific known name, not extracting an arbitrary one out
// of free text, so a stray `yarn add`/`pnpm install` can't be misread as
// a match for a script actually named "add"/"install" (vanishingly rare
// in practice, and a false NEGATIVE here — reported as undocumented when
// it technically isn't — is the safe direction for a weak signal).
export function isScriptMentioned(name: string, text: string): boolean {
  const n = escapeRegExp(name)
  const pattern = NPM_BARE_ALIASES.has(name)
    ? new RegExp(`\\b(?:npm|yarn|pnpm)(?:\\s+run(?:-script)?)?\\s+${n}\\b`)
    : new RegExp(`\\b(?:npm\\s+run(?:-script)?|yarn(?:\\s+run)?|pnpm(?:\\s+run)?)\\s+${n}\\b`)
  return pattern.test(text)
}

// npm auto-runs `pre<X>`/`post<X>` around either another declared script
// or one of npm's own built-in lifecycle events — documenting them "for
// a human" is pointless, npm calls them itself. `prepublishOnly`,
// `preinstall`, `postinstall`, `prepare` are npm's own implicit events
// (no peer script named `install`/`publishOnly` need exist for these to
// fire), so they're a fixed exemption; any other `pre*`/`post*` is only
// exempt when its own peer script is actually declared.
const RESERVED_LIFECYCLE_NAMES = new Set(['prepublishOnly', 'preinstall', 'postinstall', 'prepare'])

export function isReservedLifecycleScript(name: string, allNames: Set<string>): boolean {
  if (RESERVED_LIFECYCLE_NAMES.has(name)) return true
  const pre = /^pre(.+)/.exec(name)
  if (pre && allNames.has(pre[1] as string)) return true
  const post = /^post(.+)/.exec(name)
  if (post && allNames.has(post[1] as string)) return true
  return false
}

export function analyzeScriptsCheck(
  scripts: Record<string, string>,
  packageJsonFile: string,
  packageJsonText: string,
  sources: ScriptSource[],
): ScriptsCheckFinding[] {
  const scriptNames = new Set(Object.keys(scripts))
  const findings: ScriptsCheckFinding[] = []

  const reportedMissing = new Set<string>()
  for (const source of sources) {
    for (const { name, index } of extractMentionedScripts(source.text)) {
      if (scriptNames.has(name)) continue
      const key = `${source.file}:${name}`
      if (reportedMissing.has(key)) continue
      reportedMissing.add(key)
      findings.push({ kind: 'missing', name, file: source.file, line: lineOf(source.text, index) })
    }
  }

  for (const name of scriptNames) {
    if (isReservedLifecycleScript(name, scriptNames)) continue
    const mentioned = sources.some((s) => isScriptMentioned(name, s.text))
    if (mentioned) continue
    const keyMatch = new RegExp(`"${escapeRegExp(name)}"\\s*:`).exec(packageJsonText)
    const line = keyMatch ? lineOf(packageJsonText, keyMatch.index) : 1
    findings.push({ kind: 'undocumented', name, file: packageJsonFile, line })
  }

  return findings
}
