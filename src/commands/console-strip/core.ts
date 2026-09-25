// Finds console.*/debugger statements via a real AST walk (not text
// matching, so a string/template/regex containing the literal text
// "console.log(" is never touched — same non-negotiable requirement as
// strip-comments, just naturally satisfied here since we only ever act on
// real CallExpression/DebuggerStatement nodes, no masking trick needed).
//
// Only removes a console.*/debugger call when it's the WHOLE statement —
// see features.md's console-strip edge cases for why: `x || console.log(y)`
// or `if (x) console.log(y)` (braceless body) can't be deleted without
// either breaking the expression's value or leaving `if (x) ;` behind.
// Both are left in place and reported separately instead of guessed at.
//
// Scope note: only matches a bare `console.<method>(...)` call (callee is
// exactly the identifier `console`) — `window.console.log(...)` or a
// locally-shadowed `console` variable aren't recognized. Rare enough in
// practice not to be worth the extra complexity for this command.

import ts from 'typescript'
import {
  applyDeletions,
  collapseBlankLineRuns,
  type Range,
} from '../strip-comments/apply-deletions.js'

export interface StripConsoleOptions {
  scriptKind?: ts.ScriptKind
  /** console.<method> names to remove. default ['log', 'debug'] */
  methods?: string[]
  /** also remove bare `debugger;` statements. default true */
  debugger?: boolean
}

export type SkipReason = 'embedded-in-expression' | 'braceless-body'

export interface SkippedCall {
  line: number
  column: number
  snippet: string
  reason: SkipReason
}

export interface StripConsoleResult {
  text: string
  changed: boolean
  /** how many console.* / debugger statements were actually removed */
  count: number
  skipped: SkippedCall[]
}

function isConsoleCall(node: ts.Node, methods: Set<string>): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee)) return false
  if (!ts.isIdentifier(callee.expression) || callee.expression.text !== 'console') return false
  return methods.has(callee.name.text)
}

// A single-statement (braceless) if/while/do/for body — deleting the
// statement text would leave `if (x) ;` or similar behind, so these are
// reported instead of touched.
function isBracelessSingleStatementBody(node: ts.Node): boolean {
  const parent = node.parent
  if (!parent) return false
  if (ts.isIfStatement(parent)) {
    return (
      (parent.thenStatement === node && !ts.isBlock(node)) ||
      (parent.elseStatement === node && !ts.isBlock(node))
    )
  }
  if (
    ts.isWhileStatement(parent) ||
    ts.isDoStatement(parent) ||
    ts.isForStatement(parent) ||
    ts.isForInStatement(parent) ||
    ts.isForOfStatement(parent)
  ) {
    return parent.statement === node && !ts.isBlock(node)
  }
  return false
}

function snippetFor(sf: ts.SourceFile, node: ts.Node): string {
  const full = node.getText(sf).replace(/\s+/g, ' ').trim()
  return full.length > 60 ? `${full.slice(0, 57)}...` : full
}

export function stripConsole(text: string, options: StripConsoleOptions = {}): StripConsoleResult {
  const scriptKind = options.scriptKind ?? ts.ScriptKind.TS
  const methods = new Set(options.methods ?? ['log', 'debug'])
  const includeDebugger = options.debugger ?? true

  const sf = ts.createSourceFile('f.ts', text, ts.ScriptTarget.Latest, true, scriptKind)

  const ranges: Range[] = []
  const skipped: SkippedCall[] = []

  function reportSkip(node: ts.Node, reason: SkipReason): void {
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    skipped.push({
      line: pos.line + 1,
      column: pos.character + 1,
      snippet: snippetFor(sf, node),
      reason,
    })
  }

  function visit(node: ts.Node): void {
    if (includeDebugger && ts.isDebuggerStatement(node)) {
      if (isBracelessSingleStatementBody(node)) {
        reportSkip(node, 'braceless-body')
      } else {
        ranges.push([node.getStart(sf), node.getEnd()])
      }
      return
    }

    if (isConsoleCall(node, methods)) {
      const parent = node.parent
      const isWholeStatement =
        parent !== undefined && ts.isExpressionStatement(parent) && parent.expression === node

      if (!isWholeStatement) {
        reportSkip(node, 'embedded-in-expression')
      } else if (isBracelessSingleStatementBody(parent)) {
        reportSkip(parent, 'braceless-body')
      } else {
        ranges.push([parent.getStart(sf), parent.getEnd()])
      }
      // Don't descend into a console call's own arguments — a
      // console.log(console.log(x)) nested case is vanishingly unlikely
      // and descending would double-report/double-delete.
      return
    }

    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (ranges.length === 0) return { text, changed: false, count: 0, skipped }

  const out = collapseBlankLineRuns(applyDeletions(text, ranges))
  return { text: out, changed: true, count: ranges.length, skipped }
}
