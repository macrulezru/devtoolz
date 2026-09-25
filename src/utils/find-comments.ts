import ts from 'typescript'

export type Range = [start: number, end: number]

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
  // character outside the BMP) into a single array element, drifting
  // every later position. `split('')` is UTF-16-code-unit based, so it
  // stays aligned with the parser's own positions.
  const chars = text.split('')
  for (const [s, e] of ranges) {
    for (let i = s; i < e; i++) {
      if (chars[i] !== '\n') chars[i] = 'x'
    }
  }
  return chars.join('')
}

function scanCommentRanges(maskedText: string): Range[] {
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

/**
 * Finds every REAL comment range in `text` — string/template/regex/JSX
 * text contents are masked first (same length, so positions don't shift)
 * so a `//` or `/*` inside one of those is never mistaken for a comment.
 * Shared by `strip-comments` (deletes these ranges) and `todo-report`
 * (reads their text) — same non-negotiable requirement, same fix.
 */
export function findCommentRanges(text: string, sf: ts.SourceFile): Range[] {
  const masked = maskLiterals(text, findLiteralRanges(sf))
  return scanCommentRanges(masked)
}
