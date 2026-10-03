import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { ImageHashUsageError } from './core.js'

export const SHARP_SPEC = 'sharp@^0.35.5'
export const MANAGED_DEPS_DIR = join(homedir(), '.devtoolz', 'deps')

export interface RawImage {
  data: Uint8Array
  info: { width: number; height: number }
}

export interface SharpImage {
  metadata(): Promise<{ width?: number; height?: number; orientation?: number }>
  rotate(): SharpImage
  resize(options: {
    width: number
    height: number
    fit: 'inside'
    withoutEnlargement: boolean
  }): SharpImage
  ensureAlpha(): SharpImage
  raw(): SharpImage
  toBuffer(options: { resolveWithObject: true }): Promise<RawImage>
}

export interface SharpFactory {
  (input: string, options?: { failOn?: 'none' }): SharpImage
  cache?: (options: boolean) => unknown
}

export interface SharpLoaderDeps {
  resolveBundled: () => SharpFactory | null
  resolveManaged: () => SharpFactory | null
  install: () => boolean
  confirm: (question: string) => Promise<boolean>
  interactive: boolean
}

function toFactory(loaded: unknown): SharpFactory {
  if (typeof loaded === 'function') return loaded as SharpFactory
  return (loaded as { default: SharpFactory }).default
}

function tryRequire(requireFrom: string): SharpFactory | null {
  try {
    return toFactory(createRequire(requireFrom)('sharp'))
  } catch {
    return null
  }
}

function installIntoManagedDir(): boolean {
  mkdirSync(MANAGED_DEPS_DIR, { recursive: true })
  const manifest = join(MANAGED_DEPS_DIR, 'package.json')
  if (!existsSync(manifest)) {
    writeFileSync(manifest, JSON.stringify({ name: 'devtoolz-deps', private: true }, null, 2))
  }
  const result = spawnSync(
    'npm',
    ['install', SHARP_SPEC, '--prefix', MANAGED_DEPS_DIR, '--no-audit', '--no-fund'],
    { stdio: ['ignore', 'inherit', 'inherit'], shell: process.platform === 'win32' },
  )
  return result.status === 0
}

async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  let answer: string
  try {
    answer = (await rl.question(`${question} [Y/n]: `)).trim().toLowerCase()
  } finally {
    rl.close()
  }
  return answer === '' || answer === 'y' || answer === 'yes'
}

export function defaultSharpLoaderDeps(): SharpLoaderDeps {
  return {
    resolveBundled: () => tryRequire(import.meta.url),
    resolveManaged: () => tryRequire(join(MANAGED_DEPS_DIR, 'package.json')),
    install: installIntoManagedDir,
    confirm: askYesNo,
    interactive: Boolean(process.stdin.isTTY) && Boolean(process.stderr.isTTY),
  }
}

export async function loadSharp(
  options: { assumeYes?: boolean },
  deps: SharpLoaderDeps = defaultSharpLoaderDeps(),
): Promise<SharpFactory> {
  const existing = deps.resolveBundled() ?? deps.resolveManaged()
  if (existing) return existing

  const manualHint = `Install it yourself with: npm install ${SHARP_SPEC}`
  if (!options.assumeYes) {
    if (!deps.interactive) {
      throw new ImageHashUsageError(
        `image-hash needs the "sharp" image library, and it is not installed. ` +
          `Run with --yes to let devtoolz install it into ${MANAGED_DEPS_DIR}. ${manualHint}`,
      )
    }
    const agreed = await deps.confirm(
      `image-hash needs the "sharp" image library (native, ~30 MB). Install it into ${MANAGED_DEPS_DIR}?`,
    )
    if (!agreed) {
      throw new ImageHashUsageError(`"sharp" was not installed, nothing to do. ${manualHint}`)
    }
  }

  if (!deps.install()) {
    throw new ImageHashUsageError(`Installing "sharp" failed. ${manualHint}`)
  }
  const installed = deps.resolveManaged()
  if (!installed) {
    throw new ImageHashUsageError(
      `"sharp" was installed but could not be loaded on this platform. ${manualHint}`,
    )
  }
  return installed
}
