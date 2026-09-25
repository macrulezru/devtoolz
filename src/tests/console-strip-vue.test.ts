import { describe, expect, it } from 'vitest'
import { stripConsoleVue } from '../commands/console-strip/vue.js'

describe('stripConsoleVue', () => {
  it('removes a standalone console.log from the <script> block', () => {
    const input = '<script setup>\nconsole.log("x")\nconst a = 1\n</script>\n'
    const result = stripConsoleVue(input)
    expect(result.changed).toBe(true)
    expect(result.text).toBe('<script setup>\nconst a = 1\n</script>\n')
  })

  it('offsets a skipped entry line number by the lines before <script>', () => {
    const input =
      '<!-- header -->\n<!-- another -->\n<script setup>\nif (a) console.log(a)\n</script>\n'
    const result = stripConsoleVue(input)
    expect(result.changed).toBe(false)
    // line 1: <!-- header -->, line 2: <!-- another -->, line 3: <script>, line 4: if (...)
    expect(result.skipped[0]?.line).toBe(4)
  })

  it('returns changed: false when there is no <script> block', () => {
    const input = '<template>\n  <div>x</div>\n</template>\n'
    const result = stripConsoleVue(input)
    expect(result.changed).toBe(false)
    expect(result.text).toBe(input)
  })
})
