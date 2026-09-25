import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runOrphanTests } from '../commands/orphan-tests/run.js'

describe('runOrphanTests', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'devtoolz-orphan-tests-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function write(relPath: string, content = ''): void {
    const full = join(root, relPath)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }

  it('flags a test file whose source was deleted/renamed', () => {
    write('src/foo.test.ts')
    const report = runOrphanTests({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([
      { file: 'src/foo.test.ts', triedExtensions: expect.any(Array) },
    ])
    expect(report.exitCode).toBe(1)
  })

  it('does not flag a test file that has a matching source file', () => {
    write('src/foo.ts')
    write('src/foo.test.ts')
    const report = runOrphanTests({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([])
    expect(report.exitCode).toBe(0)
  })

  it('finds a source file one level up when the test sits in a __tests__/tests sibling directory', () => {
    write('src/adapters/http.ts')
    write('src/adapters/__tests__/http.test.ts')
    const report = runOrphanTests({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([])
  })

  it('still flags a genuine orphan inside a __tests__ directory', () => {
    write('src/adapters/http.ts')
    write('src/adapters/__tests__/http.test.ts')
    write('src/adapters/__tests__/removed.test.ts')
    const report = runOrphanTests({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([
      { file: 'src/adapters/__tests__/removed.test.ts', triedExtensions: expect.any(Array) },
    ])
  })

  it('matches a source file under any configured source extension, not just the same one', () => {
    write('src/Widget.vue')
    write('src/Widget.spec.ts')
    const report = runOrphanTests({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([])
  })

  it('ignores a file that does not end in a configured test suffix', () => {
    write('src/helpers.ts')
    const report = runOrphanTests({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([])
  })

  it('honors a custom --test-suffix list', () => {
    write('src/foo.unit.ts')
    const withDefault = runOrphanTests({ paths: ['src'], cwd: root })
    expect(withDefault.findings).toEqual([])

    const withCustom = runOrphanTests({ paths: ['src'], cwd: root, testSuffixes: ['.unit'] })
    expect(withCustom.findings).toEqual([
      { file: 'src/foo.unit.ts', triedExtensions: expect.any(Array) },
    ])
  })

  it('supports a mirrored test-dir/source-dir layout', () => {
    write('src/utils/format.ts')
    write('tests/utils/format.test.ts')
    write('tests/utils/missing.test.ts')
    const report = runOrphanTests({
      paths: [],
      cwd: root,
      sourceDir: 'src',
      testDir: 'tests',
    })
    expect(report.findings).toEqual([
      { file: 'tests/utils/missing.test.ts', triedExtensions: expect.any(Array) },
    ])
  })

  it('errors when only one of --source-dir/--test-dir is given', () => {
    const report = runOrphanTests({ paths: [], cwd: root, sourceDir: 'src' })
    expect(report.error).toMatch(/--source-dir and --test-dir must be given together/)
    expect(report.exitCode).toBe(1)
  })

  it('excludes an integration test with no matching source via --ignore', () => {
    write('src/foo.ts')
    write('src/foo.test.ts')
    write('src/integration.test.ts')
    const withoutIgnore = runOrphanTests({ paths: ['src'], cwd: root })
    expect(withoutIgnore.findings).toEqual([
      { file: 'src/integration.test.ts', triedExtensions: expect.any(Array) },
    ])

    const withIgnore = runOrphanTests({
      paths: ['src'],
      cwd: root,
      ignoreGlobs: ['src/integration.test.ts'],
    })
    expect(withIgnore.findings).toEqual([])
  })

  it('reports no findings for a clean project', () => {
    write('src/a.ts')
    write('src/a.test.ts')
    write('src/b.tsx')
    write('src/b.spec.tsx')
    const report = runOrphanTests({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([])
    expect(report.exitCode).toBe(0)
  })
})
