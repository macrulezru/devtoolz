import { describe, expect, it } from 'vitest'
import { unifiedDiff } from '../utils/diff.js'

describe('unifiedDiff', () => {
  it('produces a real unified diff between two texts', () => {
    const result = unifiedDiff('a.ts', 'const x = 1\n', 'const x = 2\n')
    expect(result).toContain('-const x = 1')
    expect(result).toContain('+const x = 2')
  })

  it('does not leave a trailing tab on the --- / +++ header lines', () => {
    const result = unifiedDiff('a.ts', 'x\n', 'y\n')
    const headerLines = result
      .split('\n')
      .filter((l) => l.startsWith('--- ') || l.startsWith('+++ '))
    expect(headerLines.length).toBeGreaterThan(0)
    for (const line of headerLines) expect(line).not.toMatch(/\t$/)
  })
})
