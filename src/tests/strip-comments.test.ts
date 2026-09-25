import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { stripComments } from '../commands/strip-comments/core.js'

describe('stripComments', () => {
  it('removes a whole-line // comment, including its trailing newline', () => {
    const input = '// leading\nconst x = 1\n'
    const result = stripComments(input)
    expect(result.changed).toBe(true)
    expect(result.text).toBe('const x = 1\n')
  })

  it('removes a trailing inline // comment but keeps the code on that line', () => {
    const input = 'const x = 1 // note\nconst y = 2\n'
    const result = stripComments(input)
    expect(result.text).toBe('const x = 1\nconst y = 2\n')
  })

  it('removes a /* */ block comment', () => {
    const input = 'function f() {\n  /* internal */\n  return 1\n}\n'
    const result = stripComments(input)
    expect(result.text).toBe('function f() {\n  return 1\n}\n')
  })

  it('removes a /** */ JSDoc comment by default', () => {
    const input = '/**\n * doc\n */\nexport function f() {}\n'
    const result = stripComments(input)
    expect(result.text).toBe('export function f() {}\n')
  })

  it('keepJsdoc preserves a /** */ directly above an exported declaration', () => {
    const input = '/**\n * doc\n */\nexport function f() {}\n'
    const result = stripComments(input, { keepJsdoc: true })
    expect(result.changed).toBe(false)
    expect(result.text).toBe(input)
  })

  it('keepJsdoc still strips a /** */ above a NON-exported declaration', () => {
    const input = '/**\n * doc\n */\nfunction internal() {}\n'
    const result = stripComments(input, { keepJsdoc: true })
    expect(result.text).toBe('function internal() {}\n')
  })

  it('keepJsdoc still strips a plain /* */ (not JSDoc-style) above an export', () => {
    const input = '/* plain */\nexport function f() {}\n'
    const result = stripComments(input, { keepJsdoc: true })
    expect(result.text).toBe('export function f() {}\n')
  })

  it('does not touch // inside a template literal', () => {
    const input = 'const url = `${a.protocol}//${a.host}`\n'
    const result = stripComments(input)
    expect(result.changed).toBe(false)
    expect(result.text).toBe(input)
  })

  it('does not touch a regex literal that looks like a comment start', () => {
    const input = 'const re = /^\\/([^/]+)\\//\n'
    const result = stripComments(input)
    expect(result.changed).toBe(false)
    expect(result.text).toBe(input)
  })

  it('does not touch // inside a plain string literal', () => {
    const input = "const s = 'http://example.com'\n"
    const result = stripComments(input)
    expect(result.changed).toBe(false)
    expect(result.text).toBe(input)
  })

  it('collapses 3+ consecutive blank lines left behind to a single blank line', () => {
    const input = 'const a = 1\n// gone\n\n\nconst b = 2\n'
    const result = stripComments(input)
    expect(result.text).toBe('const a = 1\n\nconst b = 2\n')
  })

  it('collapses blank-line runs on CRLF files without leaving stray \\r characters', () => {
    const input = 'const a = 1\r\n// gone\r\n\r\n\r\nconst b = 2\r\n'
    const result = stripComments(input)
    expect(result.text).toBe('const a = 1\r\n\r\nconst b = 2\r\n')
    expect(result.text).not.toMatch(/\r(?!\n)/)
  })

  it('returns changed: false and the identical text when there is nothing to strip', () => {
    const input = 'const x = 1\n'
    const result = stripComments(input)
    expect(result.changed).toBe(false)
    expect(result.text).toBe(input)
  })

  it('correctly strips a comment that comes after an astral character (emoji) in an earlier string literal', () => {
    // Regression test: an emoji is a surrogate pair (2 UTF-16 code units)
    // but 1 Unicode code point — TS positions count in code units, so any
    // masking step that iterates the source by code point (`[...text]`)
    // drifts out of alignment with those positions the moment one shows
    // up, corrupting everything stripped after it.
    const input = "const label = '🧰 devtoolz'\n// gone\nconst x = 1\n"
    const result = stripComments(input)
    expect(result.text).toBe("const label = '🧰 devtoolz'\nconst x = 1\n")
  })

  it('does not corrupt a string literal containing an emoji even when nothing is stripped from it', () => {
    const input = "const label = '🧰 devtoolz — chores, automated'\nconst x = 1\n"
    const result = stripComments(input)
    expect(result.changed).toBe(false)
    expect(result.text).toBe(input)
  })

  it('handles multiple astral characters before a later comment without drifting further each time', () => {
    const input = "const a = '🧰🎯🚀'\nconst b = 1 // note\nconst c = 2\n"
    const result = stripComments(input)
    expect(result.text).toBe("const a = '🧰🎯🚀'\nconst b = 1\nconst c = 2\n")
  })

  it('accepts JS scriptKind for plain .js-style input', () => {
    const input = '// x\nmodule.exports = {}\n'
    const result = stripComments(input, { scriptKind: ts.ScriptKind.JS })
    expect(result.text).toBe('module.exports = {}\n')
  })
})
