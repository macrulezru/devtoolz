// Minimal ANSI palette — no chalk/picocolors dependency for a handful of
// escape codes. Every caller gates these behind `isFancyOutputEnabled()`
// from vibes.ts, never applied unconditionally.
export const RESET = '\x1b[0m'
export const BOLD = '\x1b[1m'
export const DIM = '\x1b[2m'
export const RED = '\x1b[31m'
export const GREEN = '\x1b[32m'
export const CYAN = '\x1b[36m'
export const WHITE = '\x1b[97m'

export function colorize(color: string, text: string): string {
  return `${color}${text}${RESET}`
}
