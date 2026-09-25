import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runCircularImports } from '../commands/circular-imports/run.js'

describe('runCircularImports', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'devtoolz-circular-imports-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function write(relPath: string, content: string): void {
    const full = join(root, relPath)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }

  it('reports no findings when the import graph has no cycle', () => {
    write('a.ts', 'export const a = 1\n')
    write('b.ts', "import { a } from './a.js'\nexport const b = a + 1\n")
    const report = runCircularImports({ paths: ['.'], cwd: root })
    expect(report.findings).toEqual([])
    expect(report.exitCode).toBe(0)
  })

  it('finds a direct two-file cycle', () => {
    write('a.ts', "import { b } from './b.js'\nexport const a = 1\nconsole.log(b)\n")
    write('b.ts', "import { a } from './a.js'\nexport const b = 1\nconsole.log(a)\n")
    const report = runCircularImports({ paths: ['.'], cwd: root })
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]?.files).toEqual(['a.ts', 'b.ts'])
    expect(report.findings[0]?.typeOnly).toBe(false)
    expect(report.exitCode).toBe(1)
  })

  it('finds a longer three-file cycle and reports the full chain', () => {
    write('a.ts', "import { b } from './b.js'\nexport const a = 1\nconsole.log(b)\n")
    write('b.ts', "import { c } from './c.js'\nexport const b = 1\nconsole.log(c)\n")
    write('c.ts', "import { a } from './a.js'\nexport const c = 1\nconsole.log(a)\n")
    const report = runCircularImports({ paths: ['.'], cwd: root })
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]?.files).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })

  it('does not flag a cycle made entirely of `import type` edges by default', () => {
    write('a.ts', "import type { B } from './b.js'\nexport type A = { b: B }\n")
    write('b.ts', "import type { A } from './a.js'\nexport type B = { a: A }\n")
    const report = runCircularImports({ paths: ['.'], cwd: root })
    expect(report.findings).toEqual([])
    expect(report.exitCode).toBe(0)
  })

  it('shows a type-only cycle when --include-types is passed', () => {
    write('a.ts', "import type { B } from './b.js'\nexport type A = { b: B }\n")
    write('b.ts', "import type { A } from './a.js'\nexport type B = { a: A }\n")
    const report = runCircularImports({ paths: ['.'], cwd: root, includeTypes: true })
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]?.typeOnly).toBe(true)
  })

  it('treats a cycle as value-level if even one of its edges is a real (non-type) import', () => {
    write('a.ts', "import type { B } from './b.js'\nexport type A = { b: B }\n")
    write('b.ts', "import { a } from './a.js'\nexport const b = 1\nconsole.log(a)\n")
    const report = runCircularImports({ paths: ['.'], cwd: root })
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]?.typeOnly).toBe(false)
  })

  it('ignores bare (third-party package) specifiers entirely', () => {
    write('a.ts', "import { z } from 'zod'\nexport const a = z\n")
    const report = runCircularImports({ paths: ['.'], cwd: root })
    expect(report.findings).toEqual([])
  })

  it('does not hang on a self-referencing file (a file that "imports" its own path)', () => {
    write('a.ts', "import { a } from './a.js'\nexport const a: number = 1\n")
    const report = runCircularImports({ paths: ['.'], cwd: root })
    // a genuine self-cycle — reported once, not an infinite loop
    expect(report.findings.length).toBeLessThanOrEqual(1)
  })

  it('finds two independent cycles in the same project, not just the first one', () => {
    write('a.ts', "import { b } from './b.js'\nexport const a = 1\nconsole.log(b)\n")
    write('b.ts', "import { a } from './a.js'\nexport const b = 1\nconsole.log(a)\n")
    write('x.ts', "import { y } from './y.js'\nexport const x = 1\nconsole.log(y)\n")
    write('y.ts', "import { x } from './x.js'\nexport const y = 1\nconsole.log(x)\n")
    const report = runCircularImports({ paths: ['.'], cwd: root })
    expect(report.findings).toHaveLength(2)
  })
})
