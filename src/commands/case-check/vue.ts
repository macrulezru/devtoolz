import { findSpecifiers, type SpecifierOccurrence } from './parse.js'

const SCRIPT_RE = /<script[^>]*>/

/**
 * Same as `findSpecifiers`, but for a `.vue` file's `<script>` block —
 * positions are offset by the block's real start in the full file, so a
 * fix computed against them still lands correctly when applied to the
 * whole file's text, not just the extracted body.
 */
export function findSpecifiersInVue(text: string, file: string): SpecifierOccurrence[] {
  const openMatch = text.match(SCRIPT_RE)
  if (!openMatch || openMatch.index === undefined) return []

  const closeIndex = text.indexOf('</script>', openMatch.index)
  if (closeIndex === -1) return []

  const bodyStart = openMatch.index + openMatch[0].length
  const body = text.slice(bodyStart, closeIndex)
  const lineOffset = (text.slice(0, bodyStart).match(/\n/g) ?? []).length

  return findSpecifiers(body, file).map((occ) => ({
    ...occ,
    start: occ.start + bodyStart,
    end: occ.end + bodyStart,
    line: occ.line + lineOffset,
  }))
}
