import { describe, expect, it } from 'vitest'
import { formatFileCountRows } from '../format/file-list.js'

describe('formatFileCountRows', () => {
  it('returns an empty array for no entries', () => {
    expect(formatFileCountRows([], (n) => `x${n}`)).toEqual([])
  })

  it('aligns file names and right-aligns counts as plain text outside a TTY', () => {
    const rows = formatFileCountRows(
      [
        { file: 'src/a.ts', count: 1 },
        { file: 'src/commands/long/name.ts', count: 25 },
      ],
      (n) => `comment${n === 1 ? '' : 's'}`,
    )
    expect(rows).toHaveLength(2)
    // both rows are the same total length — that's what "aligned columns" means
    expect(rows[0]).toHaveLength(rows[1]?.length as number)
    expect(rows[0]?.trimStart()).toMatch(/^src\/a\.ts\s+1 comment$/)
    expect(rows[1]?.trimStart()).toBe('src/commands/long/name.ts  25 comments')
  })

  it('does not include parentheses around the count', () => {
    const rows = formatFileCountRows([{ file: 'a.ts', count: 3 }], (n) => `x${n}`)
    expect(rows[0]).not.toContain('(')
    expect(rows[0]).not.toContain(')')
  })
})
