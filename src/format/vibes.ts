// Centralized pool of the CLI's "personality" moments — see features.md
// "Тон вывода" for the ground rules this exists to enforce: humor only at
// bookending moments (banner, all-clean celebration), never inside the
// actual findings list, and only when there's a real human at a real
// terminal to appreciate it. Every command imports from here instead of
// hardcoding a joke inline, so the tone can be tuned in one place.

export interface VibesOptions {
  /** --quiet: suppress everything but the bare essentials */
  quiet?: boolean
  /** --plain: force plain output even in a real TTY (explicit opt-out) */
  plain?: boolean
}

// Fancy output (color, banner, celebration copy) only makes sense for a
// human watching a real terminal in real time — auto-off the moment any of
// that isn't true, no flag required. `--json`/`--quiet`/`--plain` are
// additional explicit opt-outs on top of this auto-detection.
export function isFancyOutputEnabled(options: VibesOptions = {}): boolean {
  if (options.quiet || options.plain) return false
  if (process.env.NO_COLOR) return false
  if (process.env.CI) return false
  if (!process.stdout.isTTY) return false
  return true
}

function pick<T>(pool: readonly T[]): T {
  const item = pool[Math.floor(Math.random() * pool.length)]
  // pool is always non-empty at every call site below — see the arrays
  // themselves, not worth threading `| undefined` through every caller.
  return item as T
}

const BANNERS = [
  '🧰 devtoolz',
  '🧰 devtoolz — chores, automated',
  '🧰 devtoolz, reporting for duty',
]

// One compact line, shown once per invocation — never a multi-line ASCII
// block. That's reserved for the all-clean celebration below, where it's
// actually earned.
export function banner(): string {
  return pick(BANNERS)
}

const CLEAN_LINES = [
  'Nothing to see here. Suspiciously clean, even.',
  'Spotless. Go treat yourself.',
  '0 findings. The codebase gods are pleased.',
  'Clean sweep. No notes.',
  "All clear — didn't even break a sweat.",
  'Nothing found. Somebody already did their homework.',
]

const CLEAN_ART = [
  ['   ✨', '  ( ﾉ^ヮ^)ﾉ', '   good stuff'].join('\n'),
  ['   ┏(＾0＾)┛', '   nothing to fix here'].join('\n'),
  ['   ( •_•)>⌐■-■', '   (⌐■_■)', '   deal with it'].join('\n'),
]

// The one moment ASCII art is allowed at all — a command found ZERO
// issues. Small, a few lines max, never on a run that actually found
// something (see features.md: don't joke over a real problem report).
export function cleanCelebration(options: VibesOptions = {}): string {
  const line = pick(CLEAN_LINES)
  if (!isFancyOutputEnabled(options)) return line
  return `${line}\n${pick(CLEAN_ART)}`
}

const FIRST_RUN_LINES = ["First time here? Let's see what we've got.", 'Taking a look...']

export function firstRunAside(options: VibesOptions = {}): string | null {
  if (!isFancyOutputEnabled(options)) return null
  return pick(FIRST_RUN_LINES)
}
