import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isColorEnabled } from '../format/vibes.js'
import { createStyle } from '../format/style.js'
import { renderTable } from '../format/table.js'
import { formatFindingsRows } from '../format/findings-list.js'
import { renderTodoReportReport } from '../commands/todo-report/report.js'
import { renderFullCheckReport } from '../commands/full-check/report.js'
import type { TodoReportReport } from '../commands/todo-report/run.js'
import type { FullCheckReport } from '../commands/full-check/run.js'

const ESC = '\x1b['
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const stripAnsi = (text: string) => text.replace(ANSI, '')

describe('isColorEnabled', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    delete process.env.NO_COLOR
    delete process.env.FORCE_COLOR
    delete process.env.CI
    delete process.env.TERM
  })

  afterEach(() => {
    process.env = { ...saved }
  })

  it('is off when stdout is not a terminal', () => {
    expect(isColorEnabled({})).toBe(false)
  })

  it('--color forces it on even when piped or in CI', () => {
    process.env.CI = '1'
    expect(isColorEnabled({ color: true })).toBe(true)
  })

  it('FORCE_COLOR turns it on and FORCE_COLOR=0 leaves it off', () => {
    process.env.FORCE_COLOR = '1'
    expect(isColorEnabled({})).toBe(true)
    process.env.FORCE_COLOR = '0'
    expect(isColorEnabled({})).toBe(false)
  })

  it('NO_COLOR wins over FORCE_COLOR, --plain wins over --color', () => {
    process.env.FORCE_COLOR = '1'
    process.env.NO_COLOR = '1'
    expect(isColorEnabled({})).toBe(false)
    expect(isColorEnabled({ color: true, plain: true })).toBe(false)
  })
})

describe('createStyle', () => {
  it('returns text untouched when color is off', () => {
    const s = createStyle({})
    expect(s.problem('x')).toBe('x')
    expect(s.hint('pass -y to apply')).toBe('pass -y to apply')
    expect(s.location('src/a.ts:12:5')).toBe('src/a.ts:12:5')
  })

  it('wraps text in ANSI codes when forced', () => {
    const s = createStyle({ color: true })
    expect(s.problem('x')).toContain(ESC)
    expect(stripAnsi(s.problem('x'))).toBe('x')
  })

  it('highlights CLI flags inside a hint without altering the text', () => {
    const s = createStyle({ color: true })
    const hint = '(nothing written — pass -y to apply, or --dry-run to keep previewing)'
    const out = s.hint(hint)
    expect(stripAnsi(out)).toBe(hint)
    expect(out).toContain(`${ESC}36m-y`)
    expect(out).toContain(`${ESC}36m--dry-run`)
    expect(out).not.toContain(`${ESC}36mtype`)
  })

  it('colors the file and the line:column part of a location separately', () => {
    const s = createStyle({ color: true })
    const out = s.location('src/a.ts:12:5  ')
    expect(stripAnsi(out)).toBe('src/a.ts:12:5  ')
    expect(out).toContain(`${ESC}36msrc/a.ts`)
    expect(out).toContain(`${ESC}90m:12:5`)
  })
})

describe('renderTable', () => {
  const columns = [
    { header: 'File', shrink: true },
    { header: 'Size', align: 'right' as const },
  ]

  it('draws a boxed table whose lines are all the same width', () => {
    const lines = renderTable(
      columns,
      [
        ['a.png', '10×20'],
        ['dir/long-name.jpg', '5×5'],
      ],
      {},
      null,
    )
    expect(lines).toHaveLength(6)
    expect(new Set(lines.map((l) => l.length)).size).toBe(1)
    expect(lines[1]).toContain('File')
    expect(lines[3]).toContain('a.png')
  })

  it('right-aligns a right column', () => {
    const lines = renderTable(
      columns,
      [
        ['a', '5×5'],
        ['b', '120×300'],
      ],
      {},
      null,
    )
    expect(lines[3]).toMatch(/│\s+5×5 │$/)
  })

  it('shortens the shrinkable column from the left to fit the terminal width', () => {
    const long = 'very/deep/folder/structure/that/goes/on/and/on/image.png'
    const lines = renderTable(columns, [[long, '1×1']], {}, 40)
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(40)
    expect(lines[3]).toContain('…')
    expect(lines[3]).toContain('image.png')
  })

  it('does not count color codes toward alignment', () => {
    const plain = renderTable(columns, [['a.png', '1×1']], {}, null)
    const colored = renderTable(
      [{ ...columns[0]!, style: createStyle({ color: true }).path }, columns[1]!],
      [['a.png', '1×1']],
      { color: true },
      null,
    )
    expect(colored.map(stripAnsi)).toEqual(plain)
  })
})

describe('report styling', () => {
  const todo: TodoReportReport = {
    filesScanned: 1,
    findings: [{ file: 'src/a.ts', line: 3, column: 4, tag: 'TODO', text: 'TODO: fix' }],
    countsByTag: { TODO: 1 },
    max: 0,
    exitCode: 1,
  }

  it('adds no ANSI codes to a report by default', () => {
    expect(renderTodoReportReport(todo, {})).not.toContain(ESC)
  })

  it('keeps the exact same text when colored, only adding codes', () => {
    const plain = renderTodoReportReport(todo, { plain: true })
    const colored = renderTodoReportReport(todo, { color: true, plain: false })
    expect(colored).toContain(ESC)
    expect(stripAnsi(colored).replace(/^.*devtoolz.*\n\n/, '')).toBe(plain)
  })

  it('colors the full-check status icons', () => {
    const report: FullCheckReport = {
      results: [
        { command: 'todo-report', exitCode: 1, findingsCount: 2, skipped: false },
        { command: 'dead-exports', exitCode: 0, findingsCount: 0, skipped: false },
      ],
      exitCode: 1,
    } as unknown as FullCheckReport
    const out = renderFullCheckReport(report, { color: true })
    expect(out).toContain(`${ESC}1m${ESC}31m✖`)
    expect(out).toContain(`${ESC}1m${ESC}32m✔`)
    expect(stripAnsi(out)).toContain('todo-report')
  })

  it('formats findings rows with colored location and name when forced', () => {
    const [row] = formatFindingsRows([{ location: 'a.ts:1', name: 'x', tag: 't' }], { color: true })
    expect(row).toContain(ESC)
    expect(stripAnsi(row ?? '')).toBe('  a.ts:1  x  t')
  })
})
