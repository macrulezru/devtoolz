// Finds every import-like specifier in a file via a real AST walk —
// `import`/`export ... from`, dynamic `import(...)`, and `require(...)` —
// each with the exact source position of the string literal itself (not
// just its decoded text), so a fix can replace precisely that span and
// keep the original quote character.

import ts from 'typescript'

export interface SpecifierOccurrence {
  specifier: string
  /** position of the opening quote */
  start: number
  /** position just past the closing quote */
  end: number
  line: number
  column: number
}

function scriptKindFor(file: string): ts.ScriptKind {
  return file.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : file.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : ts.ScriptKind.TS
}

function isRequireCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require'
  )
}

function isDynamicImportCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
}

export function findSpecifiers(text: string, file: string): SpecifierOccurrence[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file))
  const found: SpecifierOccurrence[] = []

  function push(node: ts.StringLiteral): void {
    const start = node.getStart(sf)
    const pos = sf.getLineAndCharacterOfPosition(start)
    found.push({
      specifier: node.text,
      start,
      end: node.getEnd(),
      line: pos.line + 1,
      column: pos.character + 1,
    })
  }

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      push(node.moduleSpecifier)
    } else if ((isRequireCall(node) || isDynamicImportCall(node)) && node.arguments[0]) {
      const arg = node.arguments[0]
      if (ts.isStringLiteral(arg)) push(arg)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  return found
}
