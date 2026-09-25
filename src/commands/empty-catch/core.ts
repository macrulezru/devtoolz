// Finds `catch` blocks that do nothing with the error, or do so little
// it amounts to swallowing it. A fully empty `catch (e) {}` is already
// caught by ESLint's own `no-empty` rule — the real value here is the
// case no syntax rule can see: a catch body that's nothing but
// console.* calls, which reads as error handling but silently lets
// execution continue exactly as an empty catch would.

import ts from 'typescript'

export interface EmptyCatchFinding {
  /** 1-based */
  line: number
  /** 1-based */
  column: number
  kind: 'empty' | 'console-only'
}

function scriptKindFor(file: string): ts.ScriptKind {
  return file.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : file.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : ts.ScriptKind.TS
}

/** Whether a real comment (not text inside a string) appears anywhere in the given source span — runs the actual scanner, not a text search. */
function blockHasComment(sourceText: string, start: number, end: number): boolean {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard)
  scanner.setText(sourceText, start, end - start)
  let tok = scanner.scan()
  while (tok !== ts.SyntaxKind.EndOfFileToken) {
    if (
      tok === ts.SyntaxKind.SingleLineCommentTrivia ||
      tok === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      return true
    }
    tok = scanner.scan()
  }
  return false
}

function isConsoleCall(expr: ts.Expression): boolean {
  return (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    ts.isIdentifier(expr.expression.expression) &&
    expr.expression.expression.text === 'console'
  )
}

function isConsoleOnlyStatement(stmt: ts.Statement): boolean {
  return ts.isExpressionStatement(stmt) && isConsoleCall(stmt.expression)
}

export function analyzeEmptyCatch(text: string, file: string): EmptyCatchFinding[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file))
  const findings: EmptyCatchFinding[] = []

  function visit(node: ts.Node): void {
    if (ts.isCatchClause(node)) {
      const block = node.block
      if (!blockHasComment(text, block.getStart(sf), block.getEnd())) {
        const statements = block.statements
        if (statements.length === 0) {
          const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf))
          findings.push({ line: pos.line + 1, column: pos.character + 1, kind: 'empty' })
        } else if (statements.every(isConsoleOnlyStatement)) {
          const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf))
          findings.push({ line: pos.line + 1, column: pos.character + 1, kind: 'console-only' })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  return findings
}
