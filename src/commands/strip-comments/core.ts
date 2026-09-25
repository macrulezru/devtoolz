// Core comment-stripping logic for a single TS/JS source string. Ported
// from the working draft at C:\work\Наработки\strip-comments — same
// approach, same guarantees, now with `keepJsdoc` added on top (the draft
// didn't have it — see features.md's strip-comments edge cases).
//
// Why not a naive regex or a plain `ts.createScanner` loop: without full
// parser context, a raw scanner can't tell a regex literal's `/` from a
// comment-start `/` (e.g. `/^\/([^/]+)\//`), and can't tell `//` inside a
// template literal (e.g. `` `${url.protocol}//${url.hostname}` ``) from a
// real line comment either — both cases silently corrupt the file. This
// fully parses the source first to find every string/template/regex/JSX
// text span, masks their contents (same length, so positions don't
// shift), then scans the masked copy for comments and deletes those exact
// byte ranges from the ORIGINAL text. No re-printing/reformatting —
// everything outside a comment is byte-identical to the input.

import ts from 'typescript'
import { applyDeletions, collapseBlankLineRuns, type Range } from './apply-deletions.js'

const LITERAL_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.JsxText,
])

function findLiteralRanges(sf: ts.SourceFile): Range[] {
  const ranges: Range[] = []
  function visit(node: ts.Node): void {
    if (LITERAL_KINDS.has(node.kind)) {
      ranges.push([node.getStart(sf), node.getEnd()])
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return ranges
}

function maskLiterals(text: string, ranges: Range[]): string {
  // `ts.SourceFile` positions are UTF-16 CODE UNIT offsets (same as
  // `string.length`/`charAt`) — `[...text]`/`Array.from(text)` iterate by
  // CODE POINT instead, collapsing any surrogate pair (an emoji, or any
  // character outside the BMP) into a single array element. The moment a
  // literal masked earlier in the file contains one, every position after
  // it drifts by one (or more) index, and later deletions land on the
  // wrong bytes entirely. `split('')` is UTF-16-code-unit based — it
  // splits a surrogate pair into its two halves instead of merging them,
  // which is exactly what keeps this array's indices aligned with the
  // parser's.
  const chars = text.split('')
  for (const [s, e] of ranges) {
    for (let i = s; i < e; i++) {
      if (chars[i] !== '\n') chars[i] = 'x'
    }
  }
  return chars.join('')
}

function findCommentRanges(maskedText: string): Range[] {
  const ranges: Range[] = []
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    maskedText,
  )
  let tok = scanner.scan()
  while (tok !== ts.SyntaxKind.EndOfFileToken) {
    if (
      tok === ts.SyntaxKind.SingleLineCommentTrivia ||
      tok === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      ranges.push([scanner.getTokenStart(), scanner.getTokenEnd()])
    }
    tok = scanner.scan()
  }
  return ranges
}

// Every `/** ... */` immediately leading an `export`-modified declaration
// — these are what `keepJsdoc` protects from deletion. Only JSDoc-style
// (`/**`, not a plain `/*`) counts, matching the convention IDEs actually
// read tooltips from.
function findExportedJsdocRanges(sf: ts.SourceFile, text: string): Range[] {
  const ranges: Range[] = []
  function visit(node: ts.Node): void {
    const hasExportModifier =
      ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    if (hasExportModifier) {
      const leading = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []
      for (const c of leading) {
        if (
          c.kind === ts.SyntaxKind.MultiLineCommentTrivia &&
          text.slice(c.pos, c.pos + 3) === '/**'
        ) {
          ranges.push([c.pos, c.end])
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return ranges
}

export interface StripCommentsOptions {
  /** ts.ScriptKind.TS (default) or ts.ScriptKind.JS — pass JS for plain .js/.cjs/.mjs files */
  scriptKind?: ts.ScriptKind
  /** don't delete a /** *\/ comment immediately above an exported declaration. default false */
  keepJsdoc?: boolean
}

export interface StripCommentsResult {
  text: string
  /** true if anything was actually deleted — lets callers skip a no-op write */
  changed: boolean
  /** how many individual comments were removed (before adjacent ones get merged into one deletion) */
  count: number
}

export function stripComments(
  text: string,
  options: StripCommentsOptions = {},
): StripCommentsResult {
  const scriptKind = options.scriptKind ?? ts.ScriptKind.TS
  const sf = ts.createSourceFile('f.ts', text, ts.ScriptTarget.Latest, true, scriptKind)

  const literalRanges = findLiteralRanges(sf)
  const masked = maskLiterals(text, literalRanges)
  let comments = findCommentRanges(masked)
  if (comments.length === 0) return { text, changed: false, count: 0 }

  if (options.keepJsdoc) {
    const protectedRanges = new Set(findExportedJsdocRanges(sf, text).map(([s, e]) => `${s}:${e}`))
    comments = comments.filter(([s, e]) => !protectedRanges.has(`${s}:${e}`))
    if (comments.length === 0) return { text, changed: false, count: 0 }
  }

  const out = collapseBlankLineRuns(applyDeletions(text, comments))
  return { text: out, changed: true, count: comments.length }
}
