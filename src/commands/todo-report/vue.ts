// `.vue` handling, same split as strip-comments/vue.ts: the `<script>`
// block goes through the real TS-parser path (core.ts), and the
// `<template>` block's `<!-- -->` comments are matched by regex — no full
// SFC template parser here, so a `<!-- -->`-looking sequence inside a
// bound attribute string would be misread as a real comment. Same known,
// documented limitation as strip-comments.

import {
  analyzeTodoReport,
  buildTagMatcher,
  collectNoteText,
  DEFAULT_TAGS,
  type TodoFinding,
} from './core.js'

const SCRIPT_RE = /(<script[^>]*>)([\s\S]*?)(<\/script>)/
const TEMPLATE_RE = /(<template[^>]*>)([\s\S]*?)(<\/template>)/
const TEMPLATE_COMMENT_RE = /<!--[\s\S]*?-->/g

function lineAt(text: string, index: number): number {
  return (text.slice(0, index).match(/\n/g) ?? []).length
}

function cleanTemplateLine(line: string): string {
  return line
    .replace(/^\s*<!--/, '')
    .replace(/-->\s*$/, '')
    .trim()
}

function findTemplateTodos(body: string, tags: string[]): TodoFinding[] {
  const findings: TodoFinding[] = []
  const { pattern, canonical } = buildTagMatcher(tags)

  for (const match of body.matchAll(TEMPLATE_COMMENT_RE)) {
    const start = match.index
    const rawLines = match[0].split('\n')
    let lineStart = start
    let i = 0
    while (i < rawLines.length) {
      const rawLine = rawLines[i] as string
      const m = pattern.exec(rawLine)
      if (m) {
        const { text: noteText, consumedThrough } = collectNoteText(
          rawLines,
          i,
          cleanTemplateLine,
          pattern,
        )
        findings.push({
          line: lineAt(body, lineStart + m.index) + 1,
          column: lineStart + m.index - body.lastIndexOf('\n', lineStart + m.index),
          tag: canonical.get(m[0].toLowerCase()) ?? m[0],
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

export function analyzeTodoReportVue(
  text: string,
  file: string,
  tags: string[] = DEFAULT_TAGS,
): TodoFinding[] {
  const findings: TodoFinding[] = []

  const scriptMatch = text.match(SCRIPT_RE)
  if (scriptMatch) {
    const [, , body] = scriptMatch as [string, string, string, string]
    const offset = lineAt(text, scriptMatch.index!)
    for (const f of analyzeTodoReport(body, file.replace(/\.vue$/, '.ts'), tags)) {
      findings.push({ ...f, line: f.line + offset })
    }
  }

  const templateMatch = text.match(TEMPLATE_RE)
  if (templateMatch) {
    const [, , body] = templateMatch as [string, string, string, string]
    const offset = lineAt(text, templateMatch.index!)
    for (const f of findTemplateTodos(body, tags)) {
      findings.push({ ...f, line: f.line + offset })
    }
  }

  findings.sort((a, b) => a.line - b.line || a.column - b.column)
  return findings
}
