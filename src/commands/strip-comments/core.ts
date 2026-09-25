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
import { findCommentRanges } from '../../utils/find-comments.js'

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

  let comments = findCommentRanges(text, sf)
  if (comments.length === 0) return { text, changed: false, count: 0 }

  if (options.keepJsdoc) {
    const protectedRanges = new Set(findExportedJsdocRanges(sf, text).map(([s, e]) => `${s}:${e}`))
    comments = comments.filter(([s, e]) => !protectedRanges.has(`${s}:${e}`))
    if (comments.length === 0) return { text, changed: false, count: 0 }
  }

  const out = collapseBlankLineRuns(applyDeletions(text, comments))
  return { text: out, changed: true, count: comments.length }
}
