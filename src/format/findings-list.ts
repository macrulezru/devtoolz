import { isFancyOutputEnabled, type VibesOptions } from './vibes.js'
import { colorize, CYAN, DIM, WHITE } from './colors.js'

export interface FindingRow {
  /** e.g. "src/foo.ts:12" */
  location: string
  name: string
  /** e.g. "(type)", "(default)" — empty string for a plain named export */
  tag: string
}

/**
 * Three aligned columns — location (white), symbol name (cyan), trailing
 * tag (dim) — same padding-before-color rule as file-list.ts: widths are
 * computed on the plain text first, colors wrapped on afterward.
 */
export function formatFindingsRows(entries: FindingRow[], options: VibesOptions = {}): string[] {
  if (entries.length === 0) return []

  const fancy = isFancyOutputEnabled(options)
  const locationWidth = Math.max(...entries.map((e) => e.location.length))
  const nameWidth = Math.max(...entries.map((e) => e.name.length))

  return entries.map((entry) => {
    const locationPart = entry.location.padEnd(locationWidth)
    const namePart = entry.name.padEnd(nameWidth)
    const styledLocation = fancy ? colorize(WHITE, locationPart) : locationPart
    const styledName = fancy ? colorize(CYAN, namePart) : namePart
    const styledTag = entry.tag && fancy ? colorize(DIM, entry.tag) : entry.tag
    return `  ${styledLocation}  ${styledName}  ${styledTag}`.trimEnd()
  })
}
