// `.vue` handling: the `<script>` block goes through the real TS-parser
// path in core.ts (safe against strings/templates/regex inside it); the
// `<template>` block's `<!-- -->` comments go through the same
// line-aware deletion helper as core.ts, just fed regex-matched comment
// ranges instead of TS scanner tokens — there's no full Vue SFC template
// parser here, so a `<!-- -->`-looking sequence INSIDE a bound attribute
// string (e.g. `:title="'<!-- x -->'"`) would still be misread as a real
// comment. Known limitation, documented in features.md — not something
// fixable without a real template parser, which is out of scope here.

import ts from 'typescript'
import { stripComments, type StripCommentsOptions } from './core.js'
import { applyDeletions, collapseBlankLineRuns, type Range } from './apply-deletions.js'

const SCRIPT_RE = /(<script[^>]*>)([\s\S]*?)(<\/script>)/
const TEMPLATE_RE = /(<template[^>]*>)([\s\S]*?)(<\/template>)/
const TEMPLATE_COMMENT_RE = /<!--[\s\S]*?-->/g

function stripTemplateComments(body: string): { text: string; changed: boolean; count: number } {
  const ranges: Range[] = []
  for (const match of body.matchAll(TEMPLATE_COMMENT_RE)) {
    const start = match.index
    ranges.push([start, start + match[0].length])
  }
  if (ranges.length === 0) return { text: body, changed: false, count: 0 }
  return {
    text: collapseBlankLineRuns(applyDeletions(body, ranges)),
    changed: true,
    count: ranges.length,
  }
}

export function stripVueComments(
  text: string,
  options: StripCommentsOptions = {},
): { text: string; changed: boolean; count: number } {
  let changed = false
  let count = 0

  const scriptMatch = text.match(SCRIPT_RE)
  if (scriptMatch) {
    const [whole, open, body, close] = scriptMatch as [string, string, string, string]
    const result = stripComments(body, { ...options, scriptKind: ts.ScriptKind.TS })
    if (result.changed) {
      changed = true
      count += result.count
      text =
        text.slice(0, scriptMatch.index) +
        open +
        result.text +
        close +
        text.slice(scriptMatch.index! + whole.length)
    }
  }

  const templateMatch = text.match(TEMPLATE_RE)
  if (templateMatch) {
    const [whole, open, body, close] = templateMatch as [string, string, string, string]
    const result = stripTemplateComments(body)
    if (result.changed) {
      changed = true
      count += result.count
      text =
        text.slice(0, templateMatch.index) +
        open +
        result.text +
        close +
        text.slice(templateMatch.index! + whole.length)
    }
  }

  return { text, changed, count }
}
