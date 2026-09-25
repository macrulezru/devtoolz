// Extracts fenced code blocks from a markdown file, tracking the block's
// language tag and the real 1-based line number where its content starts
// (right after the opening fence), so a typecheck error inside the block
// can be reported at the exact markdown line, not an offset into a
// throwaway virtual file.

export interface CodeBlock {
  lang: string
  /** 1-based line number of the first line of code, in the ORIGINAL markdown file */
  startLine: number
  code: string
  /** an explicit `no-check` word in the fence's info string opts a block out */
  noCheck: boolean
}

const FENCE_START = /^(\s*)([`~]{3,})(.*)$/

export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const lines = markdown.split(/\r\n|\r|\n/)
  const blocks: CodeBlock[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] as string
    const openMatch = FENCE_START.exec(line)
    if (!openMatch) {
      i++
      continue
    }

    const fenceChars = openMatch[2] as string
    const fenceChar = fenceChars[0] as string
    const fenceLen = fenceChars.length
    const info = (openMatch[3] as string).trim()
    const infoWords = info.split(/\s+/).filter(Boolean)
    const lang = (infoWords[0] ?? '').toLowerCase()
    const noCheck = infoWords.slice(1).includes('no-check')

    // A closing fence must use the same character and be at least as long
    // — a shorter run of the same character inside the block is literal
    // content, not a close (standard GFM fence-length rule).
    const closeRe = new RegExp(`^\\s*${fenceChar === '`' ? '`' : '~'}{${fenceLen},}\\s*$`)
    let j = i + 1
    while (j < lines.length && !closeRe.test(lines[j] as string)) j++

    if (j >= lines.length) {
      // Unterminated fence — malformed markdown, nothing sensible to
      // extract; stop treating the rest of the file as inside this block.
      i++
      continue
    }

    blocks.push({
      lang,
      startLine: i + 2,
      code: lines.slice(i + 1, j).join('\n'),
      noCheck,
    })
    i = j + 1
  }

  return blocks
}
