import { describe, expect, it } from 'vitest'
import { stripVueComments } from '../commands/strip-comments/vue.js'

describe('stripVueComments', () => {
  it('strips comments from the <script> block via the real TS parser', () => {
    const input = '<script setup>\n// gone\nconst x = 1\n</script>\n'
    const result = stripVueComments(input)
    expect(result.changed).toBe(true)
    expect(result.text).toBe('<script setup>\nconst x = 1\n</script>\n')
  })

  it('strips a whole-line <!-- --> comment from the <template> block', () => {
    const input = '<template>\n  <!-- gone -->\n  <div>x</div>\n</template>\n'
    const result = stripVueComments(input)
    expect(result.text).toBe('<template>\n  <div>x</div>\n</template>\n')
  })

  it('strips a trailing inline <!-- --> comment, keeping the markup on that line', () => {
    const input = '<template>\n  <div>x</div> <!-- gone -->\n</template>\n'
    const result = stripVueComments(input)
    expect(result.text).toBe('<template>\n  <div>x</div>\n</template>\n')
  })

  it('leaves a .vue file with no <script> block alone on that side', () => {
    const input = '<template>\n  <!-- gone -->\n  <div>x</div>\n</template>\n'
    const result = stripVueComments(input)
    expect(result.text).not.toContain('<script>')
    expect(result.changed).toBe(true)
  })

  it('returns changed: false when there is nothing to strip in either block', () => {
    const input =
      '<script setup>\nconst x = 1\n</script>\n\n<template>\n  <div>{{ x }}</div>\n</template>\n'
    const result = stripVueComments(input)
    expect(result.changed).toBe(false)
    expect(result.text).toBe(input)
  })
})
