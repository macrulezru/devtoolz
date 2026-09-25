import ts from 'typescript'
import { findCommentRanges, type Range } from '../../utils/find-comments.js'

export interface TsIgnoreDirective {
  /** 1-based line the `// @ts-ignore` comment itself sits on */
  line: number
  /** 1-based line it's meant to suppress a diagnostic on — line + 1, unconditionally */
  targetLine: number
  range: Range
}

// TypeScript's own real semantics require a `@ts-ignore` directive to sit
// on the line IMMEDIATELY above the one it protects — a blank line
// between them makes it a no-op. No special-casing that here: if the
// blank line breaks it, the real compiler already won't suppress
// anything there in the FIRST (as-is) pass, so comparing that against
// the SECOND (directive-blanked) pass naturally shows no new diagnostic
// either way — the two-pass delta in run.ts already gets this right
// without knowing about blank lines at all.
export function findTsIgnoreDirectives(text: string, sf: ts.SourceFile): TsIgnoreDirective[] {
  const directives: TsIgnoreDirective[] = []
  for (const range of findCommentRanges(text, sf)) {
    const [start, end] = range
    const commentText = text.slice(start, end)
    if (!commentText.startsWith('//')) continue
    const body = commentText.slice(2).trim()
    if (!/^@ts-ignore\b/.test(body)) continue
    const line = sf.getLineAndCharacterOfPosition(start).line + 1
    directives.push({ line, targetLine: line + 1, range })
  }
  return directives
}

// Replaces each directive's comment text with spaces of the SAME length
// (never touching newlines), same masking technique as
// `utils/find-comments.ts` — the line becomes blank/whitespace, so
// TypeScript no longer treats it as a suppressing directive at all, and
// every OTHER line in the file keeps its exact original position.
export function blankDirectives(text: string, directives: TsIgnoreDirective[]): string {
  const chars = text.split('')
  for (const { range } of directives) {
    const [start, end] = range
    for (let i = start; i < end; i++) {
      if (chars[i] !== '\n') chars[i] = ' '
    }
  }
  return chars.join('')
}
