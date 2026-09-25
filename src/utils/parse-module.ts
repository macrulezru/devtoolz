// Per-file extraction of exports/imports via a real TS parse — no regex
// guessing at `export`/`import` keywords, so a string/comment containing
// those words is never mistaken for the real thing. Shared by every
// command that needs a file's import/export surface (dead-exports,
// circular-imports, unused-deps) — not specific to any one of them.

import ts from 'typescript'

export interface ExportedName {
  name: string
  isType: boolean
  isDefault: boolean
  line: number
}

export interface ReexportEntry {
  /** the raw specifier, e.g. './core.js' */
  from: string
  /** the name as exported by the SOURCE module, or '*' for `export * from`/`export * as x from` */
  imported: string
  /** the name this file re-exports it as (may differ via `as`); '*' mirrors `imported` */
  exportedAs: string
  isType: boolean
}

export interface ImportedName {
  /** the raw specifier */
  from: string
  /** the name as exported by the source module, 'default', or '*' for a namespace import */
  imported: string
  isType: boolean
  /** 1-based line of the import declaration itself, for commands that report on the import site */
  line: number
}

export interface FileAnalysis {
  exports: ExportedName[]
  reexports: ReexportEntry[]
  imports: ImportedName[]
  /** a dynamic import() whose argument isn't a string literal — can't be resolved, worth flagging */
  hasUnresolvableDynamicImport: boolean
}

function scriptKindFor(file: string): ts.ScriptKind {
  return file.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : file.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : ts.ScriptKind.TS
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)
  )
}

function hasDefaultModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false)
  )
}

// Not `ts.isImportCall` — that helper exists at runtime but isn't part of
// this TypeScript version's typed public API. A dynamic `import(...)`
// parses as a CallExpression whose callee is the `import` keyword itself
// used as an expression; checking that structurally is exactly what the
// untyped helper does internally.
function isDynamicImportCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
}

function collectBindingNames(name: ts.BindingName, out: string[]): void {
  // Only plain identifiers are attributed — `export const { a, b } = obj`
  // (destructured) is a rare enough pattern for a top-level export that
  // skipping it (rather than guessing) is the safer default.
  if (ts.isIdentifier(name)) out.push(name.text)
}

export function analyzeFile(text: string, file: string): FileAnalysis {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file))

  function lineOf(node: ts.Node): number {
    return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  }

  const exports: ExportedName[] = []
  const reexports: ReexportEntry[] = []
  const imports: ImportedName[] = []
  let hasUnresolvableDynamicImport = false

  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt)) {
      const isTypeOnly = stmt.isTypeOnly
      const moduleSpecifier =
        stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
          ? stmt.moduleSpecifier.text
          : null

      if (stmt.exportClause) {
        if (ts.isNamedExports(stmt.exportClause)) {
          for (const el of stmt.exportClause.elements) {
            const importedName = (el.propertyName ?? el.name).text
            const exportedAs = el.name.text
            const elIsType = isTypeOnly || el.isTypeOnly
            if (moduleSpecifier) {
              reexports.push({
                from: moduleSpecifier,
                imported: importedName,
                exportedAs,
                isType: elIsType,
              })
            } else {
              exports.push({
                name: exportedAs,
                isType: elIsType,
                isDefault: false,
                line: lineOf(el),
              })
            }
          }
        } else if (ts.isNamespaceExport(stmt.exportClause) && moduleSpecifier) {
          // `export * as ns from './y'` — ns itself is a real named export
          // of THIS file (a namespace object), not traced further.
          exports.push({
            name: stmt.exportClause.name.text,
            isType: isTypeOnly,
            isDefault: false,
            line: lineOf(stmt.exportClause),
          })
        }
      } else if (moduleSpecifier) {
        // `export * from './y'` — every name './y' exports becomes
        // reachable through this file too; resolved in core.ts once every
        // file's own export list is known.
        reexports.push({
          from: moduleSpecifier,
          imported: '*',
          exportedAs: '*',
          isType: isTypeOnly,
        })
      }
      continue
    }

    if (ts.isExportAssignment(stmt)) {
      // `export default expr` and legacy `export = expr` both surface as
      // this file's default-like export — see FileAnalysis' isDefault
      // doc: usage detection for it is intentionally loose.
      exports.push({ name: 'default', isType: false, isDefault: true, line: lineOf(stmt) })
      continue
    }

    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const from = stmt.moduleSpecifier.text
      const clause = stmt.importClause
      const line = lineOf(stmt)
      if (!clause) continue // bare `import './x'` — side-effect only, not a usage of any named export

      if (clause.name) imports.push({ from, imported: 'default', isType: clause.isTypeOnly, line })

      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          imports.push({ from, imported: '*', isType: clause.isTypeOnly, line })
        } else if (ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            const importedName = (el.propertyName ?? el.name).text
            imports.push({
              from,
              imported: importedName,
              isType: clause.isTypeOnly || el.isTypeOnly,
              line,
            })
          }
        }
      }
      continue
    }

    if (hasExportModifier(stmt)) {
      const isType = ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)
      const isDefault = hasDefaultModifier(stmt)

      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          const names: string[] = []
          collectBindingNames(decl.name, names)
          for (const name of names) {
            exports.push({ name, isType: false, isDefault: false, line: lineOf(decl) })
          }
        }
      } else if (
        (ts.isFunctionDeclaration(stmt) ||
          ts.isClassDeclaration(stmt) ||
          ts.isInterfaceDeclaration(stmt) ||
          ts.isTypeAliasDeclaration(stmt) ||
          ts.isEnumDeclaration(stmt) ||
          ts.isModuleDeclaration(stmt)) &&
        stmt.name
      ) {
        const name = ts.isIdentifier(stmt.name) ? stmt.name.text : stmt.name.text
        exports.push({ name: isDefault ? 'default' : name, isType, isDefault, line: lineOf(stmt) })
      }
    }
  }

  // Dynamic import() calls can appear anywhere in an expression, not just
  // at the top level — a full walk (not just top-level statements) is
  // needed to find them all.
  function visit(node: ts.Node): void {
    if (isDynamicImportCall(node)) {
      const arg = node.arguments[0]
      if (arg && ts.isStringLiteral(arg)) {
        // A literal path we can resolve — conservatively treat the whole
        // target module as used (see core.ts) rather than trying to trace
        // which bindings a `const { x } = await import(...)` destructures.
        imports.push({ from: arg.text, imported: '*', isType: false, line: lineOf(node) })
      } else {
        hasUnresolvableDynamicImport = true
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  return { exports, reexports, imports, hasUnresolvableDynamicImport }
}
