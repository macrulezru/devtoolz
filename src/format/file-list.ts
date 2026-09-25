import { isFancyOutputEnabled, type VibesOptions } from './vibes.js'
import { colorize, DIM, WHITE } from './colors.js'

export interface FileCountEntry {
  file: string
  count: number
}

/**
 * Renders a `file  count` list as two aligned columns — file path on the
 * left (white when fancy output is on), count on the right (dim), no
 * parens around it. Padding is computed on the PLAIN text first and only
 * wrapped in color codes afterward — padding a string that already has
 * ANSI escapes in it counts those invisible bytes toward the width and
 * throws the alignment off.
 */
export function formatFileCountRows(
  entries: FileCountEntry[],
  unit: (count: number) => string,
  options: VibesOptions = {},
): string[] {
  if (entries.length === 0) return []

  const fancy = isFancyOutputEnabled(options)
  const fileWidth = Math.max(...entries.map((e) => e.file.length))
  const countTexts = entries.map((e) => `${e.count} ${unit(e.count)}`)
  const countWidth = Math.max(...countTexts.map((t) => t.length))

  return entries.map((entry, i) => {
    const filePart = entry.file.padEnd(fileWidth)
    const countPart = (countTexts[i] as string).padStart(countWidth)
    const styledFile = fancy ? colorize(WHITE, filePart) : filePart
    const styledCount = fancy ? colorize(DIM, countPart) : countPart
    return `  ${styledFile}  ${styledCount}`
  })
}
