import type ts from 'typescript'
import { extractCodeBlocks } from './extract.js'
import { typecheckBlock } from './typecheck.js'

export interface ReadmeCheckFinding {
  file: string
  /** 1-based, real line in the markdown file */
  line: number
  /** 1-based column */
  column: number
  message: string
  lang: string
}

export interface ReadmeCheckFileResult {
  file: string
  blocksChecked: number
  blocksSkipped: number
  findings: ReadmeCheckFinding[]
}

// "Cannot find name" (2304) and its "did you mean" variant (2552) — a doc
// snippet is routinely a FRAGMENT that assumes a variable set up in
// surrounding prose or an earlier, unrelated block ("inside your
// component:", "given a `router` instance, ..."). Checking each block in
// isolation (see below) can't tell that apart from a genuinely wrong
// example, so it doesn't try — these codes are dropped rather than
// reported as unreliable noise. Concatenating blocks together to give
// them shared context was tried and reverted: real dogfooding against
// every README in this workspace showed it trades this false-positive
// class for a WORSE one (two independent, alternative examples that
// happen to reuse a name like `toast`/`useForm` read as "Cannot redeclare
// block-scoped variable" — an alarming false bug report, not an obvious
// tool limitation the way "Cannot find name" reads).
//
// "X is declared but its value is never read" (6133) — a doc snippet
// routinely defines a handler function that's wired up somewhere NOT
// shown in the fenced block (a template's `@click`, an event listener
// registered elsewhere in prose) — real dogfooding hit this exact shape
// in vue-toast-kit's README (`function deleteFile(id) { ... }`, never
// called within its own isolated block). Also fires as a pure cascade of
// an already-suppressed 2304/2307 upstream (an unresolvable import
// leaves nothing to meaningfully call the declaration "unused" against).
const SUPPRESSED_CODES = new Set([2304, 2552, 6133])

// "Cannot find module './X'" (2307) for a RELATIVE specifier is almost
// always a hypothetical file in the reader's own project ("your
// App.vue"), not something that could ever exist in this package — not
// checkable, so not reported. A BARE specifier (the package's own name,
// or one of its subpath exports) is kept: that's the one historically
// valuable case this command exists for (vue-image-kit's /cdn export
// resolving to nothing at runtime while nobody noticed).
const MODULE_NOT_FOUND_CODE = 2307
const RELATIVE_MODULE_RE = /Cannot find module '(\.\.?\/[^']*)'/

// A DIFFERENT code (2792, not 2307) for the case where the package's own
// dev tsconfig doesn't set `moduleResolution: bundler/node16/nodenext` at
// all — self-referencing its own name can never resolve there regardless
// of what the README says, and TypeScript's message says so explicitly
// ("Did you mean to set the 'moduleResolution' option..."). That's how
// this is told apart from a genuine bad specifier under a properly
// bundler-configured tsconfig (plain 2307, no such suffix) — the real
// vue-state-machine bug this command caught: its README's code examples
// still imported the unscoped `vue-state-machine` in five places after a
// scope-prefix fix elsewhere had already landed.
const UNSUPPORTED_RESOLUTION_CODE = 2792

function isNoise(message: string, code: number): boolean {
  if (SUPPRESSED_CODES.has(code)) return true
  if (code === MODULE_NOT_FOUND_CODE && RELATIVE_MODULE_RE.test(message)) return true
  if (code === UNSUPPORTED_RESOLUTION_CODE) return true
  return false
}

/**
 * Each block is typechecked in isolation — never accumulated with other
 * blocks in the same file. See `isNoise` above for what that isolation
 * costs and how it's mitigated.
 */
export function checkMarkdownFile(
  file: string,
  markdown: string,
  packageDir: string,
  compilerOptions: ts.CompilerOptions,
  langs: string[],
): ReadmeCheckFileResult {
  const blocks = extractCodeBlocks(markdown)
  const findings: ReadmeCheckFinding[] = []
  let blocksChecked = 0
  let blocksSkipped = 0

  for (const block of blocks) {
    if (block.noCheck || !langs.includes(block.lang)) {
      blocksSkipped++
      continue
    }

    const diagnostics = typecheckBlock(block.code, block.lang, packageDir, compilerOptions)
    if (diagnostics === null) {
      blocksSkipped++
      continue
    }

    blocksChecked++
    for (const d of diagnostics) {
      if (d.category !== 'error') continue
      if (isNoise(d.message, d.code)) continue
      findings.push({
        file,
        line: block.startLine + d.line,
        column: d.character + 1,
        message: d.message,
        lang: block.lang,
      })
    }
  }

  return { file, blocksChecked, blocksSkipped, findings }
}
