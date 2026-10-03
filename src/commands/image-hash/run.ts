import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { encode as encodeBlurhash } from 'blurhash'
import { rgbaToThumbHash } from 'thumbhash'
import { walk } from '../../utils/walk.js'
import {
  DEFAULT_BLURHASH_COMPONENTS,
  DEFAULT_EXPORT_NAME,
  DEFAULT_IMAGE_EXTENSIONS,
  DEFAULT_SAMPLE_SIZE,
  ImageHashUsageError,
  formatAggregate,
  formatPerFile,
  normalizeOutExtension,
  outputFileName,
  splitPathArguments,
  validateExportName,
  validateSuffix,
  withUpperCaseVariants,
  type HashEntry,
  type HashType,
  type OutputFormat,
} from './core.js'
import { loadSharp, type SharpFactory } from './sharp-loader.js'

export interface ImageHashRunOptions {
  paths: string[]
  cwd: string
  types: HashType[]
  recursive?: boolean
  extensions?: string[]
  ignoreGlobs?: string[]
  respectGitignore?: boolean
  components?: { x: number; y: number }
  size?: number
  format?: OutputFormat
  exportName?: string
  out?: string
  perFile?: boolean
  outDir?: string
  suffix?: string
  outExtension?: string
  concurrency?: number
  assumeYes?: boolean
  dryRun?: boolean
  sharp?: SharpFactory
  onProgress?: (message: string) => void
}

export interface ImageHashError {
  file: string
  message: string
}

export interface ImageHashReport {
  filesScanned: number
  entries: HashEntry[]
  written: string[]
  errors: ImageHashError[]
  stdout: string | null
  dryRun: boolean
  exitCode: number
}

interface SourceImage {
  abs: string
  root: string
}

function toPosix(path: string): string {
  return path.split('\\').join('/')
}

function collectImages(options: ImageHashRunOptions, errors: ImageHashError[]): SourceImage[] {
  const extensions = withUpperCaseVariants(options.extensions ?? DEFAULT_IMAGE_EXTENSIONS)
  const images: SourceImage[] = []
  const seen = new Set<string>()

  for (const input of splitPathArguments(options.paths)) {
    const abs = resolve(options.cwd, input)
    const stat = statSync(abs, { throwIfNoEntry: false })
    if (!stat) {
      errors.push({ file: input, message: 'path does not exist' })
      continue
    }
    const root = stat.isDirectory() ? abs : dirname(abs)
    const found = walk([abs], {
      cwd: options.cwd,
      extensions,
      ignoreGlobs: options.ignoreGlobs ?? [],
      recursive: options.recursive ?? false,
      ...(options.respectGitignore !== undefined
        ? { respectGitignore: options.respectGitignore }
        : {}),
    })
    for (const file of found) {
      if (seen.has(file)) continue
      seen.add(file)
      images.push({ abs: file, root })
    }
  }

  return images.sort((a, b) => a.abs.localeCompare(b.abs))
}

async function hashImage(
  sharp: SharpFactory,
  image: SourceImage,
  options: ImageHashRunOptions,
): Promise<HashEntry> {
  const size = options.size ?? DEFAULT_SAMPLE_SIZE
  const components = options.components ?? DEFAULT_BLURHASH_COMPONENTS

  const metadata = await sharp(image.abs, { failOn: 'none' }).metadata()
  const swapped = (metadata.orientation ?? 1) >= 5
  const width = (swapped ? metadata.height : metadata.width) ?? 0
  const height = (swapped ? metadata.width : metadata.height) ?? 0

  const { data, info } = await sharp(image.abs, { failOn: 'none' })
    .rotate()
    .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const entry: HashEntry = {
    file: toPosix(relative(options.cwd, image.abs)),
    width: width || info.width,
    height: height || info.height,
  }
  if (options.types.includes('blurhash')) {
    entry.blurhash = encodeBlurhash(
      new Uint8ClampedArray(data),
      info.width,
      info.height,
      components.x,
      components.y,
    )
  }
  if (options.types.includes('thumbhash')) {
    entry.thumbhash = Buffer.from(rgbaToThumbHash(info.width, info.height, data)).toString('base64')
  }
  return entry
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index] as T)
    }
  })
  await Promise.all(workers)
  return results
}

function writeText(path: string, content: string, dryRun: boolean): void {
  if (dryRun) return
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

export async function runImageHash(options: ImageHashRunOptions): Promise<ImageHashReport> {
  const format = options.format ?? 'json'
  const exportName = validateExportName(options.exportName ?? DEFAULT_EXPORT_NAME)
  const perFile = Boolean(options.perFile) || options.outDir !== undefined
  const dryRun = Boolean(options.dryRun)

  if (options.out !== undefined && perFile) {
    throw new ImageHashUsageError('--out cannot be combined with --per-file or --out-dir')
  }
  const suffix = validateSuffix(options.suffix, options.types, format)
  const outExtension = normalizeOutExtension(options.outExtension, format)

  const errors: ImageHashError[] = []
  const images = collectImages(options, errors)

  const entries: HashEntry[] = []
  const sources = new Map<string, SourceImage>()

  if (images.length > 0) {
    const sharp = options.sharp ?? (await loadSharp({ assumeYes: options.assumeYes ?? false }))
    sharp.cache?.(false)
    const results = await mapWithConcurrency(images, options.concurrency ?? 4, async (image) => {
      try {
        const entry = await hashImage(sharp, image, options)
        options.onProgress?.(`hashed ${entry.file}`)
        return { image, entry }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { image, error: { file: toPosix(relative(options.cwd, image.abs)), message } }
      }
    })
    for (const result of results) {
      if ('entry' in result) {
        entries.push(result.entry)
        sources.set(result.entry.file, result.image)
      } else {
        errors.push(result.error)
      }
    }
  }

  entries.sort((a, b) => a.file.localeCompare(b.file))

  const written: string[] = []
  let stdout: string | null = null

  if (perFile) {
    const claimed = new Set<string>()
    for (const entry of entries) {
      const source = sources.get(entry.file) as SourceImage
      const targetDir =
        options.outDir !== undefined
          ? join(resolve(options.cwd, options.outDir), relative(source.root, dirname(source.abs)))
          : dirname(source.abs)
      for (const unit of formatPerFile(entry, options.types, format)) {
        const target = join(targetDir, outputFileName(source.abs, suffix, unit.token, outExtension))
        if (claimed.has(target)) {
          errors.push({ file: entry.file, message: `output ${target} is already taken` })
          continue
        }
        claimed.add(target)
        writeText(target, unit.content, dryRun)
        written.push(toPosix(relative(options.cwd, target)))
      }
    }
  } else {
    const content = formatAggregate(entries, options.types, format, exportName)
    if (options.out !== undefined) {
      const target = resolve(options.cwd, options.out)
      writeText(target, content, dryRun)
      written.push(toPosix(relative(options.cwd, target)))
    } else if (!dryRun) {
      stdout = content
    }
  }

  return {
    filesScanned: images.length,
    entries,
    written,
    errors,
    stdout,
    dryRun,
    exitCode: errors.length > 0 ? 1 : 0,
  }
}
