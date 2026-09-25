import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runCaseCheck } from '../commands/case-check/run.js'

describe('runCaseCheck', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'devtoolz-case-check-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function write(relPath: string, content: string): void {
    const full = join(root, relPath)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }

  it('flags an import whose case does not match the real file on disk', () => {
    write('src/Foo.ts', 'export const x = 1\n')
    write('src/consumer.ts', "import { x } from './foo.js'\nconsole.log(x)\n")
    const report = runCaseCheck({ paths: ['src'], cwd: root })
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]?.specifier).toBe('./foo.js')
    expect(report.findings[0]?.correctedSpecifier).toBe('./Foo.js')
    expect(report.exitCode).toBe(1)
  })

  it('does not flag an import whose case already matches', () => {
    write('src/foo.ts', 'export const x = 1\n')
    write('src/consumer.ts', "import { x } from './foo.js'\nconsole.log(x)\n")
    const report = runCaseCheck({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([])
    expect(report.exitCode).toBe(0)
  })

  it('checks a directory segment, not just the final file', () => {
    write('src/Utils/helper.ts', 'export const x = 1\n')
    write('src/consumer.ts', "import { x } from './utils/helper.js'\nconsole.log(x)\n")
    const report = runCaseCheck({ paths: ['src'], cwd: root })
    expect(report.findings[0]?.correctedSpecifier).toBe('./Utils/helper.js')
  })

  it('resolves an extensionless import against the real file name', () => {
    write('src/Foo.ts', 'export const x = 1\n')
    write('src/consumer.ts', "import { x } from './foo'\nconsole.log(x)\n")
    const report = runCaseCheck({ paths: ['src'], cwd: root })
    expect(report.findings[0]?.correctedSpecifier).toBe('./Foo')
  })

  it('resolves a directory import against its real casing, using the index file inside', () => {
    write('src/Components/index.ts', 'export const x = 1\n')
    write('src/consumer.ts', "import { x } from './components'\nconsole.log(x)\n")
    const report = runCaseCheck({ paths: ['src'], cwd: root })
    expect(report.findings[0]?.correctedSpecifier).toBe('./Components')
  })

  it('does not flag a bare package import', () => {
    write('src/consumer.ts', "import { z } from 'zod'\nconsole.log(z)\n")
    const report = runCaseCheck({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([])
  })

  it('does not flag an import that does not resolve to anything real', () => {
    write('src/consumer.ts', "import { x } from './totally-missing.js'\nconsole.log(x)\n")
    const report = runCaseCheck({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([])
  })

  it('--fix -y rewrites the specifier to its real case, preserving the quote style', () => {
    write('src/Foo.ts', 'export const x = 1\n')
    write('src/consumer.ts', "import { x } from './foo.js'\nconsole.log(x)\n")
    const report = runCaseCheck({ paths: ['src'], cwd: root, fix: true, yes: true })
    expect(report.applied).toBe(true)
    expect(report.exitCode).toBe(0)
    const after = readFileSync(join(root, 'src/consumer.ts'), 'utf8')
    expect(after).toBe("import { x } from './Foo.js'\nconsole.log(x)\n")
  })

  it('without -y, --fix only previews and writes nothing', () => {
    write('src/Foo.ts', 'export const x = 1\n')
    write('src/consumer.ts', "import { x } from './foo.js'\nconsole.log(x)\n")
    const before = readFileSync(join(root, 'src/consumer.ts'), 'utf8')
    const report = runCaseCheck({ paths: ['src'], cwd: root, fix: true })
    expect(report.applied).toBe(false)
    const after = readFileSync(join(root, 'src/consumer.ts'), 'utf8')
    expect(after).toBe(before)
  })

  it('fixes multiple mismatched imports in the same file correctly', () => {
    write('src/Foo.ts', 'export const foo = 1\n')
    write('src/Bar.ts', 'export const bar = 2\n')
    write(
      'src/consumer.ts',
      "import { foo } from './foo.js'\nimport { bar } from './bar.js'\nconsole.log(foo, bar)\n",
    )
    const report = runCaseCheck({ paths: ['src'], cwd: root, fix: true, yes: true })
    expect(report.findings).toHaveLength(2)
    const after = readFileSync(join(root, 'src/consumer.ts'), 'utf8')
    expect(after).toBe(
      "import { foo } from './Foo.js'\nimport { bar } from './Bar.js'\nconsole.log(foo, bar)\n",
    )
  })

  it("finds a case mismatch inside a .vue file's <script> block, with the correct line number", () => {
    write('src/Foo.ts', 'export const x = 1\n')
    write(
      'src/consumer.vue',
      "<template>\n  <div />\n</template>\n\n<script setup>\nimport { x } from './foo.js'\nconsole.log(x)\n</script>\n",
    )
    const report = runCaseCheck({ paths: ['src'], cwd: root })
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]?.line).toBe(6)
  })

  it('resolves a tsconfig path alias, reports the mismatch, but does not auto-fix it', () => {
    write(
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }),
    )
    write('src/Foo.ts', 'export const x = 1\n')
    write('src/consumer.ts', "import { x } from '@/foo.js'\nconsole.log(x)\n")
    const before = readFileSync(join(root, 'src/consumer.ts'), 'utf8')

    const report = runCaseCheck({ paths: ['src'], cwd: root, fix: true, yes: true })
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]?.isAlias).toBe(true)
    expect(report.exitCode).toBe(1) // alias mismatch is never auto-fixed, so it still counts as unresolved

    const after = readFileSync(join(root, 'src/consumer.ts'), 'utf8')
    expect(after).toBe(before) // untouched — --fix skips alias-resolved findings
  })
})
