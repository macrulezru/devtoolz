import { describe, expect, it } from 'vitest'
import { stripConsole } from '../commands/console-strip/core.js'

describe('stripConsole', () => {
  it('removes a standalone console.log statement, whole line', () => {
    const input = 'const a = 1\nconsole.log(a)\nconst b = 2\n'
    const result = stripConsole(input)
    expect(result.changed).toBe(true)
    expect(result.text).toBe('const a = 1\nconst b = 2\n')
    expect(result.skipped).toEqual([])
  })

  it('removes a standalone console.debug statement by default too', () => {
    const input = 'console.debug("x")\nconst a = 1\n'
    const result = stripConsole(input)
    expect(result.text).toBe('const a = 1\n')
  })

  it('does NOT remove console.warn/console.error by default', () => {
    const input = 'console.warn("x")\nconsole.error("y")\nconst a = 1\n'
    const result = stripConsole(input)
    expect(result.changed).toBe(false)
    expect(result.text).toBe(input)
  })

  it('removes console.warn when explicitly requested via methods', () => {
    const input = 'console.warn("x")\nconst a = 1\n'
    const result = stripConsole(input, { methods: ['warn'] })
    expect(result.text).toBe('const a = 1\n')
  })

  it('removes a bare debugger statement', () => {
    const input = 'const a = 1\ndebugger\nconst b = 2\n'
    const result = stripConsole(input)
    expect(result.text).toBe('const a = 1\nconst b = 2\n')
  })

  it('leaves debugger alone when debugger: false', () => {
    const input = 'debugger\nconst a = 1\n'
    const result = stripConsole(input, { debugger: false })
    expect(result.changed).toBe(false)
  })

  it('removes a multi-line console.log call as one unit', () => {
    const input = 'const a = 1\nconsole.log(\n  a,\n  "x",\n)\nconst b = 2\n'
    const result = stripConsole(input)
    expect(result.text).toBe('const a = 1\nconst b = 2\n')
  })

  it('removes an inline trailing console.log, keeping the code on that line', () => {
    const input = 'doThing(); console.log("x")\n'
    const result = stripConsole(input)
    expect(result.text).toBe('doThing();\n')
  })

  it('does NOT delete a console.log used as part of a larger expression, and reports it', () => {
    const input = 'const r = console.log(x) || fallback()\n'
    const result = stripConsole(input)
    expect(result.changed).toBe(false)
    expect(result.text).toBe(input)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.reason).toBe('embedded-in-expression')
  })

  it('does NOT delete console.log inside a braceless if-body, and reports it', () => {
    const input = 'if (x) console.log(x)\n'
    const result = stripConsole(input)
    expect(result.changed).toBe(false)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.reason).toBe('braceless-body')
  })

  it('DOES delete console.log inside a braced if-body', () => {
    const input = 'if (x) {\n  console.log(x)\n}\n'
    const result = stripConsole(input)
    expect(result.text).toBe('if (x) {\n}\n')
    expect(result.skipped).toEqual([])
  })

  it('does NOT delete debugger inside a braceless while-body, and reports it', () => {
    const input = 'while (x) debugger\n'
    const result = stripConsole(input)
    expect(result.changed).toBe(false)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.reason).toBe('braceless-body')
  })

  it('does not touch the text "console.log(" inside a string literal', () => {
    const input = "const s = 'console.log(hi)'\n"
    const result = stripConsole(input)
    expect(result.changed).toBe(false)
    expect(result.text).toBe(input)
  })

  it('reports line/column for a skipped call', () => {
    const input = 'const a = 1\nif (a) console.log(a)\n'
    const result = stripConsole(input)
    expect(result.skipped[0]?.line).toBe(2)
  })

  it('returns changed: false and identical text when nothing matches', () => {
    const input = 'const a = 1\n'
    const result = stripConsole(input)
    expect(result.changed).toBe(false)
    expect(result.text).toBe(input)
    expect(result.skipped).toEqual([])
  })
})
