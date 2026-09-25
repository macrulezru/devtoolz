import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runReadmeCheck } from '../commands/readme-check/run.js'
import { extractCodeBlocks } from '../commands/readme-check/extract.js'

describe('extractCodeBlocks', () => {
  it('extracts a fenced block and its real starting line', () => {
    const md = ['# Title', '', '```ts', 'const x = 1', '```', ''].join('\n')
    const blocks = extractCodeBlocks(md)
    expect(blocks).toEqual([{ lang: 'ts', startLine: 4, code: 'const x = 1', noCheck: false }])
  })

  it('ignores a non-fence line containing backticks', () => {
    const md = ['This `code` is inline, not a fence.', '', '```ts', 'ok', '```'].join('\n')
    const blocks = extractCodeBlocks(md)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.code).toBe('ok')
  })

  it('treats a shorter run of the fence char inside the block as literal content, not a close', () => {
    const md = ['````ts', 'const s = "```"', '````'].join('\n')
    const blocks = extractCodeBlocks(md)
    expect(blocks).toEqual([{ lang: 'ts', startLine: 2, code: 'const s = "```"', noCheck: false }])
  })

  it('parses the no-check meta word to opt a block out', () => {
    const md = ['```ts no-check', 'this is not real code', '```'].join('\n')
    const blocks = extractCodeBlocks(md)
    expect(blocks[0]?.noCheck).toBe(true)
  })

  it('skips an unterminated fence instead of consuming the rest of the file', () => {
    const md = ['```ts', 'const x = 1'].join('\n')
    const blocks = extractCodeBlocks(md)
    expect(blocks).toEqual([])
  })

  it('extracts multiple independent blocks with correct line numbers each', () => {
    const md = [
      '# Title',
      '',
      '```ts',
      'const a = 1',
      '```',
      '',
      'text',
      '',
      '```ts',
      'const b = 2',
      '```',
    ].join('\n')
    const blocks = extractCodeBlocks(md)
    expect(blocks).toEqual([
      { lang: 'ts', startLine: 4, code: 'const a = 1', noCheck: false },
      { lang: 'ts', startLine: 10, code: 'const b = 2', noCheck: false },
    ])
  })
})

describe('runReadmeCheck', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'devtoolz-readme-check-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function write(relPath: string, content: string): void {
    const full = join(root, relPath)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }

  function writeBasePackage(): void {
    write(
      'package.json',
      JSON.stringify({
        name: 'demo-pkg',
        version: '1.0.0',
        type: 'module',
        exports: { '.': './src/index.ts' },
      }),
    )
    write(
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
        },
      }),
    )
    write(
      'src/index.ts',
      'export function greet(name: string): string {\n  return `Hello, ${name}!`\n}\n',
    )
  }

  it('reports no findings when every ts block typechecks cleanly', () => {
    writeBasePackage()
    write(
      'README.md',
      [
        '# demo-pkg',
        '',
        '```ts',
        "import { greet } from './src/index.js'",
        '',
        "const message: string = greet('world')",
        '```',
        '',
      ].join('\n'),
    )
    const report = runReadmeCheck({ dir: root })
    expect(report.findings).toEqual([])
    expect(report.exitCode).toBe(0)
    expect(report.fileResults[0]?.blocksChecked).toBe(1)
  })

  it('flags a genuine type error at the real markdown line and column', () => {
    writeBasePackage()
    write(
      'README.md',
      [
        '# demo-pkg',
        '',
        '```ts',
        "import { greet } from './src/index.js'",
        '',
        "const n: number = greet('world')",
        '```',
        '',
      ].join('\n'),
    )
    const report = runReadmeCheck({ dir: root })
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]?.line).toBe(6)
    expect(report.findings[0]?.message).toContain(
      "Type 'string' is not assignable to type 'number'",
    )
    expect(report.exitCode).toBe(1)
  })

  it("resolves a self-referencing import by the package's own published name", () => {
    writeBasePackage()
    write(
      'README.md',
      [
        '# demo-pkg',
        '',
        '```ts',
        "import { greet } from 'demo-pkg'",
        '',
        "greet('world')",
        '```',
        '',
      ].join('\n'),
    )
    const report = runReadmeCheck({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('catches a genuinely wrong example against a self-referencing import', () => {
    writeBasePackage()
    write(
      'README.md',
      [
        '# demo-pkg',
        '',
        '```ts',
        "import { doesNotExist } from 'demo-pkg'",
        '',
        'doesNotExist()',
        '```',
        '',
      ].join('\n'),
    )
    const report = runReadmeCheck({ dir: root })
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]?.message).toContain('has no exported member')
  })

  it('does not typecheck a non-ts fenced block by default', () => {
    writeBasePackage()
    write(
      'README.md',
      ['# demo-pkg', '', '```json', '{ "this is": "not typescript" }', '```', ''].join('\n'),
    )
    const report = runReadmeCheck({ dir: root })
    expect(report.findings).toEqual([])
    expect(report.fileResults[0]?.blocksChecked).toBe(0)
    expect(report.fileResults[0]?.blocksSkipped).toBe(1)
  })

  it('skips a block marked no-check even if it would otherwise fail', () => {
    writeBasePackage()
    write(
      'README.md',
      ['# demo-pkg', '', '```ts no-check', 'const n: number = "not a number"', '```', ''].join(
        '\n',
      ),
    )
    const report = runReadmeCheck({ dir: root })
    expect(report.findings).toEqual([])
    expect(report.fileResults[0]?.blocksSkipped).toBe(1)
  })

  it('checks each block independently — one broken block does not fail an unrelated clean block', () => {
    writeBasePackage()
    write(
      'README.md',
      [
        '# demo-pkg',
        '',
        '```ts',
        "const n: number = 'nope'",
        '```',
        '',
        '```ts',
        "import { greet } from './src/index.js'",
        "const ok: string = greet('world')",
        '```',
        '',
      ].join('\n'),
    )
    const report = runReadmeCheck({ dir: root })
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]?.line).toBe(4)
    expect(report.fileResults[0]?.blocksChecked).toBe(2)
  })

  it('does not flag a later block referencing a name set up by an earlier block — unreliable in isolation, so not reported rather than guessed at', () => {
    writeBasePackage()
    write(
      'README.md',
      [
        '# demo-pkg',
        '',
        'First, import and greet:',
        '',
        '```ts',
        "import { greet } from './src/index.js'",
        '',
        "const message = greet('world')",
        '```',
        '',
        'Then log it:',
        '',
        '```ts',
        'console.log(message)',
        '```',
        '',
      ].join('\n'),
    )
    const report = runReadmeCheck({ dir: root })
    expect(report.findings).toEqual([])
    expect(report.fileResults[0]?.blocksChecked).toBe(2)
  })

  it('does not flag a relative import to a file that only exists in a hypothetical consumer project', () => {
    writeBasePackage()
    write(
      'README.md',
      ['# demo-pkg', '', '```ts', "import App from './App.vue'", '```', ''].join('\n'),
    )
    const report = runReadmeCheck({ dir: root })
    expect(report.findings).toEqual([])
  })

  it("does not flag self-reference resolution failing because the package's own tsconfig doesn't support it at all", () => {
    write(
      'package.json',
      JSON.stringify({ name: 'classic-pkg', version: '1.0.0', main: './src/index.ts' }),
    )
    write('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2018', strict: true } }))
    write('src/index.ts', 'export function greet(name: string): string {\n  return name\n}\n')
    write(
      'README.md',
      ['# classic-pkg', '', '```ts', "import { greet } from 'classic-pkg'", '```', ''].join('\n'),
    )
    const report = runReadmeCheck({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('still reports a real error in a block that ALSO references undefined outside context', () => {
    writeBasePackage()
    write(
      'README.md',
      [
        '# demo-pkg',
        '',
        '```ts',
        "import { greet } from './src/index.js'",
        '',
        'console.log(contextFromEarlierProse)',
        "const n: number = greet('world')",
        '```',
        '',
      ].join('\n'),
    )
    const report = runReadmeCheck({ dir: root })
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]?.message).toContain(
      "Type 'string' is not assignable to type 'number'",
    )
  })

  it('checks a js block only when --lang opts into it, using allowJs', () => {
    writeBasePackage()
    write(
      'README.md',
      ['# demo-pkg', '', '```js', 'const n = 1', 'n.notAMethod()', '```', ''].join('\n'),
    )

    const defaultReport = runReadmeCheck({ dir: root })
    expect(defaultReport.fileResults[0]?.blocksSkipped).toBe(1)

    const jsReport = runReadmeCheck({ dir: root, langs: ['js'] })
    expect(jsReport.findings).toHaveLength(1)
    expect(jsReport.findings[0]?.message).toContain('notAMethod')
  })

  it('checks a second markdown file when --file is passed explicitly', () => {
    writeBasePackage()
    write(
      'README.md',
      ['# demo-pkg', '', '```ts', "const ok: string = 'fine'", '```', ''].join('\n'),
    )
    write(
      'docs/guide.md',
      ['# Guide', '', '```ts', "const bad: number = 'nope'", '```', ''].join('\n'),
    )

    const report = runReadmeCheck({ dir: root, files: ['README.md', 'docs/guide.md'] })
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]?.file).toBe('docs/guide.md')
  })

  it('reports a clean error, not a crash, when there is no tsconfig.json', () => {
    write('package.json', JSON.stringify({ name: 'no-tsconfig-pkg' }))
    write('README.md', ['```ts', 'const x = 1', '```'].join('\n'))
    const report = runReadmeCheck({ dir: root })
    expect(report.error).not.toBeNull()
    expect(report.exitCode).toBe(1)
  })

  it('reports a clean error, not a crash, when the target markdown file is missing', () => {
    writeBasePackage()
    const report = runReadmeCheck({ dir: root })
    expect(report.error).not.toBeNull()
    expect(report.exitCode).toBe(1)
  })
})
