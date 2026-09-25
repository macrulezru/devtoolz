import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runEmptyCatch } from '../commands/empty-catch/run.js'

describe('runEmptyCatch', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'devtoolz-empty-catch-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function write(relPath: string, content: string): void {
    const full = join(root, relPath)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }

  it('flags a fully empty catch block', () => {
    write(
      'src/a.ts',
      ['function f() {', '  try {', '    risky()', '  } catch (e) {', '  }', '}'].join('\n'),
    )
    const report = runEmptyCatch({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([{ file: 'src/a.ts', line: 4, column: 5, kind: 'empty' }])
    expect(report.exitCode).toBe(1)
  })

  it('flags a catch block whose body only logs the error', () => {
    write(
      'src/a.ts',
      [
        'function f() {',
        '  try {',
        '    risky()',
        '  } catch (e) {',
        '    console.error(e)',
        '  }',
        '}',
      ].join('\n'),
    )
    const report = runEmptyCatch({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([
      { file: 'src/a.ts', line: 4, column: 5, kind: 'console-only' },
    ])
  })

  it('does not flag a catch block that rethrows', () => {
    write(
      'src/a.ts',
      [
        'function f() {',
        '  try {',
        '    risky()',
        '  } catch (e) {',
        '    console.error(e)',
        '    throw e',
        '  }',
        '}',
      ].join('\n'),
    )
    const report = runEmptyCatch({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([])
  })

  it('does not flag a catch block that assigns to an outer-scope variable', () => {
    write(
      'src/a.ts',
      [
        'function f() {',
        '  let lastError',
        '  try {',
        '    risky()',
        '  } catch (e) {',
        '    lastError = e',
        '  }',
        '  return lastError',
        '}',
      ].join('\n'),
    )
    const report = runEmptyCatch({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([])
  })

  it('does not flag an empty catch block that has an explanatory comment', () => {
    write(
      'src/a.ts',
      [
        'function f() {',
        '  try {',
        '    risky()',
        '  } catch (e) {',
        '    // intentionally ignored, see #123',
        '  }',
        '}',
      ].join('\n'),
    )
    const report = runEmptyCatch({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([])
  })

  it('does not flag a console-only catch block that has an explanatory comment', () => {
    write(
      'src/a.ts',
      [
        'function f() {',
        '  try {',
        '    risky()',
        '  } catch (e) {',
        '    // logging only is fine here, this is best-effort telemetry',
        '    console.warn(e)',
        '  }',
        '}',
      ].join('\n'),
    )
    const report = runEmptyCatch({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([])
  })

  it('finds a nested catch block inside another catch block that does real handling', () => {
    write(
      'src/a.ts',
      [
        'function f() {',
        '  try {',
        '    risky()',
        '  } catch (outer) {',
        '    try {',
        '      recover()',
        '    } catch (inner) {',
        '    }',
        '    throw outer',
        '  }',
        '}',
      ].join('\n'),
    )
    const report = runEmptyCatch({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([{ file: 'src/a.ts', line: 7, column: 7, kind: 'empty' }])
  })

  it('finds an empty catch block inside a .vue <script> block, at the right line', () => {
    write(
      'src/App.vue',
      [
        '<template>',
        '  <div />',
        '</template>',
        '',
        '<script setup>',
        'function f() {',
        '  try {',
        '    risky()',
        '  } catch (e) {',
        '  }',
        '}',
        '</script>',
      ].join('\n'),
    )
    const report = runEmptyCatch({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([{ file: 'src/App.vue', line: 9, column: 5, kind: 'empty' }])
  })

  it('does not flag a catch body that calls a function other than console.*', () => {
    write(
      'src/a.ts',
      [
        'function f() {',
        '  try {',
        '    risky()',
        '  } catch (e) {',
        '    reportError(e)',
        '  }',
        '}',
      ].join('\n'),
    )
    const report = runEmptyCatch({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([])
  })

  it('reports no findings for a clean project', () => {
    write(
      'src/a.ts',
      [
        'function f() {',
        '  try {',
        '    risky()',
        '  } catch (e) {',
        '    throw e',
        '  }',
        '}',
      ].join('\n'),
    )
    const report = runEmptyCatch({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([])
    expect(report.exitCode).toBe(0)
  })
})
