import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runFullCheck, FULL_CHECK_COMMAND_NAMES } from '../commands/full-check/run.js'

describe('runFullCheck', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'devtoolz-full-check-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function write(relPath: string, content: string): void {
    const full = join(root, relPath)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }

  function writeHonestPackage(): void {
    write(
      'package.json',
      JSON.stringify({
        name: 'demo-pkg',
        version: '1.0.0',
        type: 'module',
        exports: { '.': './src/index.ts' },
        scripts: { build: 'tsc' },
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
    write('README.md', ['```bash', 'npm run build', '```'].join('\n'))
  }

  it('runs all thirteen commands and reports clean when the project is honest', () => {
    writeHonestPackage()
    const report = runFullCheck({ dir: root })
    expect(report.error).toBeNull()
    expect(report.results).toHaveLength(FULL_CHECK_COMMAND_NAMES.length)
    expect(report.results.map((r) => r.command)).toEqual(FULL_CHECK_COMMAND_NAMES)
    for (const result of report.results) {
      expect(result.skipped).toBe(false)
      expect(result.error).toBeNull()
      expect(result.exitCode).toBe(0)
    }
    expect(report.exitCode).toBe(0)
  })

  it('surfaces a real finding from one command without affecting the others', () => {
    writeHonestPackage()
    write(
      'src/broken.ts',
      ['export function f() {', '  try {', '    risky()', '  } catch (e) {', '  }', '}'].join('\n'),
    )
    const report = runFullCheck({ dir: root })
    const emptyCatch = report.results.find((r) => r.command === 'empty-catch')
    expect(emptyCatch?.exitCode).toBe(1)
    expect(emptyCatch?.findingsCount).toBe(1)
    expect(report.exitCode).toBe(1)

    const stripComments = report.results.find((r) => r.command === 'strip-comments')
    expect(stripComments?.exitCode).toBe(0)
  })

  it('counts individual comments across one file, not the file itself, for strip-comments', () => {
    writeHonestPackage()
    write('src/commented.ts', ['// first', '// second', 'export const x = 1'].join('\n'))
    const report = runFullCheck({ dir: root })
    const stripComments = report.results.find((r) => r.command === 'strip-comments')
    expect(stripComments?.findingsCount).toBe(2)
  })

  it('skips a named command instead of running it', () => {
    writeHonestPackage()
    const report = runFullCheck({ dir: root, skip: ['stale-ts-ignore'] })
    const staleTsIgnore = report.results.find((r) => r.command === 'stale-ts-ignore')
    expect(staleTsIgnore).toEqual({
      command: 'stale-ts-ignore',
      skipped: true,
      findingsCount: 0,
      exitCode: 0,
      error: null,
      report: null,
    })
    expect(report.exitCode).toBe(0)
  })

  it('reports an error for an unknown --skip name without running anything', () => {
    writeHonestPackage()
    const report = runFullCheck({ dir: root, skip: ['not-a-real-command'] })
    expect(report.results).toEqual([])
    expect(report.error).toMatch(/unknown command name/)
    expect(report.exitCode).toBe(1)
  })

  it('keeps going when one command errors instead of aborting the whole sweep', () => {
    // No package.json at all — unused-deps/exports-doctor/readme-check/scripts-check
    // all fail to find one, stale-ts-ignore fails to find a tsconfig — but the
    // purely file-scanning commands (empty-catch, dead-exports, ...) still run fine.
    write('src/index.ts', 'export const x = 1\n')
    const report = runFullCheck({ dir: root })

    const unusedDeps = report.results.find((r) => r.command === 'unused-deps')
    expect(unusedDeps?.error).toMatch(/no package\.json/)

    const emptyCatch = report.results.find((r) => r.command === 'empty-catch')
    expect(emptyCatch?.skipped).toBe(false)
    expect(emptyCatch?.error).toBeNull()
    expect(emptyCatch?.exitCode).toBe(0)

    expect(report.results).toHaveLength(FULL_CHECK_COMMAND_NAMES.length)
    expect(report.exitCode).toBe(1)
  })

  it('calls onCommandStart/onCommandDone for every command, in order, skipped ones included', () => {
    writeHonestPackage()
    const started: string[] = []
    const done: string[] = []
    runFullCheck({
      dir: root,
      skip: ['circular-imports'],
      onCommandStart: (command) => started.push(command),
      onCommandDone: (result) => done.push(result.command),
    })
    expect(started).toEqual(FULL_CHECK_COMMAND_NAMES.filter((c) => c !== 'circular-imports'))
    expect(done).toEqual(FULL_CHECK_COMMAND_NAMES)
  })
})
