import { describe, expect, it } from 'vitest'
import { unifiedDiff } from '../utils/diff.js'
import { renderDiffForHumans } from '../format/diff-render.js'

describe('renderDiffForHumans', () => {
  const patch = unifiedDiff('src/a.ts', 'const x = 1\nconst y = 2\n', 'const x = 1\n')

  it('replaces the raw Index:/---/+++ preamble with a header naming the file and count', () => {
    const rendered = renderDiffForHumans('src/a.ts', 2, 'comments', patch)
    expect(rendered).toContain('src/a.ts (2 comments)')
    expect(rendered).not.toContain('Index: src/a.ts')
    expect(rendered).not.toContain('===================')
  })

  it('keeps the hunk header and the actual +/- content lines', () => {
    const rendered = renderDiffForHumans('src/a.ts', 1, 'comments', patch)
    expect(rendered).toContain('@@')
    expect(rendered).toContain('-const y = 2')
  })

  it('does not add color codes outside a fancy (TTY) context', () => {
    const rendered = renderDiffForHumans('src/a.ts', 1, 'comments', patch)
    expect(rendered.includes('\x1b[')).toBe(false)
  })
})
