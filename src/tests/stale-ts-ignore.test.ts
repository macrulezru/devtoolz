import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runStaleTsIgnore } from '../commands/stale-ts-ignore/run.js'

describe('runStaleTsIgnore', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'devtoolz-stale-ts-ignore-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function write(relPath: string, content: string): void {
    const full = join(root, relPath)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }

  function writeTsconfig(): void {
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
  }

  it('flags a @ts-ignore that no longer suppresses anything', () => {
    writeTsconfig()
    write(
      'src/a.ts',
      [
        'export function greet(name: string): string {',
        '  // @ts-ignore',
        '  return `Hello, ${name}!`',
        '}',
      ].join('\n'),
    )
    const report = runStaleTsIgnore({ dir: root })
    expect(report.findings).toEqual([{ file: 'src/a.ts', line: 2 }])
    expect(report.directivesChecked).toBe(1)
    expect(report.exitCode).toBe(1)
  })

  it('does not flag a @ts-ignore genuinely suppressing a real type error', () => {
    writeTsconfig()
    write(
      'src/a.ts',
      ['export function bad(): string {', '  // @ts-ignore', '  return 123', '}'].join('\n'),
    )
    const report = runStaleTsIgnore({ dir: root })
    expect(report.findings).toEqual([])
    expect(report.exitCode).toBe(0)
  })

  it('reports no findings and skips the typecheck entirely when there are no directives at all', () => {
    writeTsconfig()
    write('src/a.ts', 'export const x = 1\n')
    const report = runStaleTsIgnore({ dir: root })
    expect(report.directivesChecked).toBe(0)
    expect(report.findings).toEqual([])
    expect(report.exitCode).toBe(0)
  })

  it('flags a stale @ts-ignore inside a .vue <script> block, at the right line', () => {
    writeTsconfig()
    write('src/main.ts', 'export const x = 1\n')
    write(
      'src/App.vue',
      [
        '<template>',
        '  <div />',
        '</template>',
        '',
        '<script lang="ts">',
        'export function greet(name: string): string {',
        '  // @ts-ignore',
        '  return `Hello, ${name}!`',
        '}',
        '</script>',
      ].join('\n'),
    )
    const report = runStaleTsIgnore({ dir: root })
    expect(report.findings).toEqual([{ file: 'src/App.vue', line: 7 }])
  })

  it('does not flag a genuinely needed @ts-ignore inside a .vue <script> block', () => {
    writeTsconfig()
    write('src/main.ts', 'export const x = 1\n')
    write(
      'src/App.vue',
      [
        '<template>',
        '  <div />',
        '</template>',
        '',
        '<script lang="ts">',
        'export function bad(): string {',
        '  // @ts-ignore',
        '  return 123',
        '}',
        '</script>',
      ].join('\n'),
    )
    const report = runStaleTsIgnore({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('treats a @ts-ignore separated from its target by a blank line as not suppressing anything', () => {
    writeTsconfig()
    write(
      'src/a.ts',
      ['export function bad(): string {', '  // @ts-ignore', '', '  return 123', '}'].join('\n'),
    )
    const report = runStaleTsIgnore({ dir: root })
    expect(report.findings).toEqual([{ file: 'src/a.ts', line: 2 }])
  })

  it('does not flag a genuine comment that merely mentions @ts-ignore inside a string', () => {
    writeTsconfig()
    write('src/a.ts', ['export const note = "// @ts-ignore, not a real directive"'].join('\n'))
    const report = runStaleTsIgnore({ dir: root })
    expect(report.directivesChecked).toBe(0)
    expect(report.findings).toEqual([])
  })

  it('reports an error when no tsconfig.json can be found', () => {
    write('src/a.ts', 'export const x = 1\n')
    const report = runStaleTsIgnore({ dir: root })
    expect(report.error).toMatch(/no tsconfig\.json found/)
    expect(report.exitCode).toBe(1)
  })
})
