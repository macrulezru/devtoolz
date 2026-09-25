import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runTodoReport } from '../commands/todo-report/run.js'

describe('runTodoReport', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'devtoolz-todo-report-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function write(relPath: string, content: string): void {
    const full = join(root, relPath)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }

  it('finds a line-comment TODO with its text', () => {
    write('src/a.ts', ['function f() {', '  // TODO: handle the empty case', '}'].join('\n'))
    const report = runTodoReport({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([
      { file: 'src/a.ts', line: 2, column: 6, tag: 'TODO', text: 'TODO: handle the empty case' },
    ])
    expect(report.exitCode).toBe(1)
  })

  it('finds FIXME and HACK too, by default', () => {
    write(
      'src/a.ts',
      ['// FIXME: this is broken', '// HACK: workaround for issue #4', 'const x = 1'].join('\n'),
    )
    const report = runTodoReport({ paths: ['src'], cwd: root })
    expect(report.findings.map((f) => f.tag)).toEqual(['FIXME', 'HACK'])
  })

  it('does not flag a string literal that merely contains the word TODO', () => {
    write('src/a.ts', ['const s = "TODO: not a real one"'].join('\n'))
    const report = runTodoReport({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([])
    expect(report.exitCode).toBe(0)
  })

  it('matches case-insensitively but reports the configured casing', () => {
    write('src/a.ts', ['// todo: lowercase in source'].join('\n'))
    const report = runTodoReport({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([
      { file: 'src/a.ts', line: 1, column: 4, tag: 'TODO', text: 'todo: lowercase in source' },
    ])
  })

  it('finds a tag on each line of a multi-line block comment', () => {
    write(
      'src/a.ts',
      ['/*', ' * TODO: first thing', ' * FIXME: second thing', ' */', 'const x = 1'].join('\n'),
    )
    const report = runTodoReport({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([
      { file: 'src/a.ts', line: 2, column: 4, tag: 'TODO', text: 'TODO: first thing' },
      { file: 'src/a.ts', line: 3, column: 4, tag: 'FIXME', text: 'FIXME: second thing' },
    ])
  })

  it('joins a note wrapped across a run of consecutive // lines into one text', () => {
    write(
      'src/a.ts',
      [
        '// TODO: real asset not uploaded yet — see design.md "Some',
        '// heading". Placeholder filenames follow the usual convention',
        '// so this starts working the moment the real files land.',
        'const x = 1',
      ].join('\n'),
    )
    const report = runTodoReport({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([
      {
        file: 'src/a.ts',
        line: 1,
        column: 4,
        tag: 'TODO',
        text: 'TODO: real asset not uploaded yet — see design.md "Some heading". Placeholder filenames follow the usual convention so this starts working the moment the real files land.',
      },
    ])
  })

  it('stops absorbing continuation lines at a blank comment line or an unrelated code line', () => {
    write(
      'src/a.ts',
      [
        '// TODO: fix this',
        '//',
        '// unrelated later comment, not part of the note',
        'const x = 1',
      ].join('\n'),
    )
    const report = runTodoReport({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([
      { file: 'src/a.ts', line: 1, column: 4, tag: 'TODO', text: 'TODO: fix this' },
    ])
  })

  it('honors a custom --tags list, ignoring the defaults', () => {
    write(
      'src/a.ts',
      ['// TODO: default tag, not configured', '// NOTE: configured tag'].join('\n'),
    )
    const report = runTodoReport({ paths: ['src'], cwd: root, tags: ['NOTE'] })
    expect(report.findings).toEqual([
      { file: 'src/a.ts', line: 2, column: 4, tag: 'NOTE', text: 'NOTE: configured tag' },
    ])
  })

  it('exits 0 when findings are within --max, 1 when over it', () => {
    write('src/a.ts', ['// TODO: one', '// TODO: two', '// TODO: three'].join('\n'))
    const withinLimit = runTodoReport({ paths: ['src'], cwd: root, max: 3 })
    expect(withinLimit.exitCode).toBe(0)
    expect(withinLimit.findings).toHaveLength(3)

    const overLimit = runTodoReport({ paths: ['src'], cwd: root, max: 2 })
    expect(overLimit.exitCode).toBe(1)
  })

  it('finds a TODO in a .vue <script> block, at the right line', () => {
    write(
      'src/App.vue',
      [
        '<template>',
        '  <div />',
        '</template>',
        '',
        '<script setup>',
        '// TODO: wire up the real API',
        'const x = 1',
        '</script>',
      ].join('\n'),
    )
    const report = runTodoReport({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([
      { file: 'src/App.vue', line: 6, column: 4, tag: 'TODO', text: 'TODO: wire up the real API' },
    ])
  })

  it('finds a TODO in a .vue <template> HTML comment, at the right line', () => {
    write(
      'src/App.vue',
      [
        '<template>',
        '  <div />',
        '  <!-- TODO: replace this placeholder markup -->',
        '</template>',
        '',
        '<script setup>',
        'const x = 1',
        '</script>',
      ].join('\n'),
    )
    const report = runTodoReport({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([
      {
        file: 'src/App.vue',
        line: 3,
        column: 8,
        tag: 'TODO',
        text: 'TODO: replace this placeholder markup',
      },
    ])
  })

  it('reports counts grouped by tag', () => {
    write('src/a.ts', ['// TODO: one', '// TODO: two', '// FIXME: three'].join('\n'))
    const report = runTodoReport({ paths: ['src'], cwd: root })
    expect(report.countsByTag).toEqual({ TODO: 2, FIXME: 1 })
  })

  it('reports no findings for a clean project', () => {
    write('src/a.ts', ['const x = 1', '// just a normal comment'].join('\n'))
    const report = runTodoReport({ paths: ['src'], cwd: root })
    expect(report.findings).toEqual([])
    expect(report.exitCode).toBe(0)
  })
})
