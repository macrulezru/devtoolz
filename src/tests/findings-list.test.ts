import { describe, expect, it } from 'vitest'
import { formatFindingsRows } from '../format/findings-list.js'

describe('formatFindingsRows', () => {
  it('returns an empty array for no entries', () => {
    expect(formatFindingsRows([])).toEqual([])
  })

  it('aligns location and name columns as plain text outside a TTY', () => {
    const rows = formatFindingsRows([
      { location: 'src/a.ts:7', name: 'ExportedName', tag: '(type)' },
      { location: 'src/format/vibes.ts:73', name: 'firstRunAside', tag: '' },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]?.trimStart()).toMatch(/^src\/a\.ts:7\s+ExportedName\s+\(type\)$/)
    // both rows' location+name columns start at the same offset — that's
    // what "aligned" means, checked directly rather than guessing widths
    expect(rows[0]?.indexOf('ExportedName') === rows[1]?.indexOf('firstRunAside')).toBe(true)
  })

  it('does not leave trailing whitespace on a row with no tag', () => {
    const rows = formatFindingsRows([{ location: 'src/a.ts:1', name: 'x', tag: '' }])
    expect(rows[0]).toBe(rows[0]?.trimEnd())
  })
})
