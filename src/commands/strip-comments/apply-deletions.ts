// Shared "delete these ranges, but a whole-line comment takes its newline
// with it" logic — used by core.ts (real TS comment tokens) and vue.ts
// (regex-matched `<!-- -->` in a <template> block). Checking whole-line-
// ness against the SURROUNDING TEXT (not just the matched substring in
// isolation) matters: a substring-only check misclassifies a trailing
// inline comment as "whole line" whenever the comment itself, in
// isolation, happens to look like one (leading/trailing whitespace) even
// though real content precedes it on the same source line — a real bug
// found via testing in the original draft this package is based on.

export type Range = [start: number, end: number]

export function lineBoundsAllWhitespace(text: string, start: number, end: number) {
  let lineStart = start
  while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--
  const beforeIsWs = /^[ \t]*$/.test(text.slice(lineStart, start))

  let lineEnd = end
  while (lineEnd < text.length && text[lineEnd] !== '\n') lineEnd++
  const afterIsWs = /^[ \t\r]*$/.test(text.slice(end, lineEnd))

  return { lineStart, lineEnd, beforeIsWs, afterIsWs }
}

/**
 * Deletes `ranges` from `text`. A range that has nothing but whitespace
 * before and after it on its own line is treated as a whole-line
 * comment — its entire line, including the trailing newline, is removed,
 * so no blank line is left behind. Otherwise, only the range itself plus
 * the run of spaces/tabs immediately before it is removed, keeping real
 * code that shares its line intact.
 */
export function applyDeletions(text: string, ranges: Range[]): string {
  if (ranges.length === 0) return text

  const deletions: Range[] = []
  for (const [start, end] of ranges) {
    const { lineStart, lineEnd, beforeIsWs, afterIsWs } = lineBoundsAllWhitespace(text, start, end)
    if (beforeIsWs && afterIsWs) {
      const delEnd = lineEnd < text.length && text[lineEnd] === '\n' ? lineEnd + 1 : lineEnd
      deletions.push([lineStart, delEnd])
    } else {
      let s = start
      while (s > 0 && (text[s - 1] === ' ' || text[s - 1] === '\t')) s--
      deletions.push([s, end])
    }
  }

  deletions.sort((a, b) => a[0] - b[0])
  const merged: Range[] = []
  for (const d of deletions) {
    const last = merged[merged.length - 1]
    if (last && d[0] <= last[1]) {
      last[1] = Math.max(last[1], d[1])
    } else {
      merged.push(d)
    }
  }

  let out = ''
  let cursor = 0
  for (const [s, e] of merged) {
    out += text.slice(cursor, s)
    cursor = e
  }
  out += text.slice(cursor)
  return out
}

// Collapses 3+ consecutive blank lines to one — `\r?` around each `\n` so
// a stray `\r` (CRLF files) doesn't survive between the newlines and
// defeat the collapse, and the replacement matches whichever line ending
// the matched stretch itself used, so a CRLF file doesn't end up with
// LF-only gaps mixed in.
export function collapseBlankLineRuns(text: string): string {
  return text.replace(/(?:\r?\n){3,}/g, (match) => (match.includes('\r') ? '\r\n\r\n' : '\n\n'))
}
