import ts from 'typescript'
import { findCommentRanges, type Range } from '../../utils/find-comments.js'
import { escapeRegExp } from '../../utils/escape-regexp.js'

export interface TodoFinding {
  line: number
  column: number
  tag: string
  text: string
}

export const DEFAULT_TAGS = ['TODO', 'FIXME', 'HACK']

function scriptKindFor(file: string): ts.ScriptKind {
  return file.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : file.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : ts.ScriptKind.TS
}

// Matches a configured tag as its own word anywhere in a comment line
// (`// see TODO above` counts, same as most editors' TODO highlighters) —
// case-insensitively, but the reported `tag` is always the CONFIGURED
// spelling/casing, not whatever casing happened to appear in the source.
export function buildTagMatcher(tags: string[]): {
  pattern: RegExp
  canonical: Map<string, string>
} {
  const canonical = new Map<string, string>()
  for (const tag of tags) canonical.set(tag.toLowerCase(), tag)
  const alternation = tags.map(escapeRegExp).join('|')
  return { pattern: new RegExp(`\\b(?:${alternation})\\b`, 'i'), canonical }
}

// Strips the comment syntax itself (`//`, `/*`, trailing `*/`, a leading
// `*` on a block comment's continuation lines) off one line of a comment,
// so the reported text is just what a human wrote.
function cleanCommentLine(line: string): string {
  return line
    .replace(/\*\/\s*$/, '')
    .replace(/^\s*\/\*+/, '')
    .replace(/^\s*\/\/+/, '')
    .replace(/^\s*\*/, '')
    .trim()
}

// A note is often wrapped across several lines — a run of `//` comments,
// or one line of a `/* */` block — and only the FIRST line contains the
// tag. Reporting just that line cuts the sentence off mid-thought (found
// via real dogfooding against npm-center's own data files: a genuine
// wrapped TODO came back truncated at "see design.md ..." with no
// continuation). This keeps absorbing subsequent lines of the same
// comment as long as they're non-empty and don't themselves start a NEW
// tagged note, joining them into one readable line.
export function collectNoteText(
  rawLines: string[],
  startIndex: number,
  clean: (line: string) => string,
  pattern: RegExp,
): { text: string; consumedThrough: number } {
  const parts = [clean(rawLines[startIndex] as string)]
  let j = startIndex + 1
  while (j < rawLines.length) {
    const line = rawLines[j] as string
    const cleaned = clean(line)
    if (!cleaned || pattern.test(line)) break
    parts.push(cleaned)
    j++
  }
  return { text: parts.join(' '), consumedThrough: j }
}

// `findCommentRanges` gives each `//` line its own separate range (that's
// how the TS scanner tokenizes them) — merges adjacent ones (nothing but
// indentation and a single newline between them) into one logical block,
// the same unit a `/* */` comment already is, so a wrapped `//` note can
// be collected the same way.
function mergeAdjacentLineComments(text: string, ranges: Range[]): Range[] {
  const merged: Range[] = []
  for (const range of ranges) {
    const [s, e] = range
    const last = merged[merged.length - 1]
    const isLineComment = text[s] === '/' && text[s + 1] === '/'
    const lastIsLineComment = last && text[last[0]] === '/' && text[last[0] + 1] === '/'
    if (
      last &&
      isLineComment &&
      lastIsLineComment &&
      /^[ \t]*\n[ \t]*$/.test(text.slice(last[1], s))
    ) {
      last[1] = e
    } else {
      merged.push([s, e])
    }
  }
  return merged
}

export function analyzeTodoReport(
  text: string,
  file: string,
  tags: string[] = DEFAULT_TAGS,
): TodoFinding[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file))
  const { pattern, canonical } = buildTagMatcher(tags)
  const findings: TodoFinding[] = []

  const ranges = mergeAdjacentLineComments(text, findCommentRanges(text, sf))
  for (const [start, end] of ranges) {
    const commentText = text.slice(start, end)
    const rawLines = commentText.split('\n')
    let lineStart = start
    let i = 0
    while (i < rawLines.length) {
      const rawLine = rawLines[i] as string
      const match = pattern.exec(rawLine)
      if (match) {
        const pos = sf.getLineAndCharacterOfPosition(lineStart + match.index)
        const { text: noteText, consumedThrough } = collectNoteText(
          rawLines,
          i,
          cleanCommentLine,
          pattern,
        )
        findings.push({
          line: pos.line + 1,
          column: pos.character + 1,
          tag: canonical.get(match[0].toLowerCase()) ?? match[0],
          text: noteText,
        })
        for (let k = i; k < consumedThrough; k++) lineStart += (rawLines[k] as string).length + 1
        i = consumedThrough
        continue
      }
      lineStart += rawLine.length + 1
      i++
    }
  }

  return findings
}
