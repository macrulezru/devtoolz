import { existsSync } from 'node:fs'
import { basename } from 'node:path'

export type HashType = 'blurhash' | 'thumbhash'

export const OUTPUT_FORMATS = ['json', 'plain', 'csv', 'ts', 'js'] as const
export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

export const DEFAULT_IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.avif',
  '.tif',
  '.tiff',
]

export const DEFAULT_EXPORT_NAME = 'imageHashes'
export const DEFAULT_BLURHASH_COMPONENTS = { x: 4, y: 3 }
export const DEFAULT_SAMPLE_SIZE = 100
export const MAX_SAMPLE_SIZE = 100

export class ImageHashUsageError extends Error {}

export interface HashEntry {
  file: string
  width: number
  height: number
  blurhash?: string
  thumbhash?: string
}

export interface OutputUnit {
  token: string
  content: string
}

export function parseTypes(value: string): HashType[] {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'both') return ['blurhash', 'thumbhash']
  if (normalized === 'blurhash' || normalized === 'thumbhash') return [normalized]
  throw new ImageHashUsageError(`--type must be blurhash, thumbhash or both (got "${value}")`)
}

export function parseFormat(value: string): OutputFormat {
  const normalized = value.trim().toLowerCase()
  const found = OUTPUT_FORMATS.find((format) => format === normalized)
  if (!found) {
    throw new ImageHashUsageError(
      `--format must be one of ${OUTPUT_FORMATS.join(', ')} (got "${value}")`,
    )
  }
  return found
}

export function parseComponents(value: string): { x: number; y: number } {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim())
  const x = match ? Number(match[1]) : 0
  const y = match ? Number(match[2]) : 0
  if (!match || x < 1 || x > 9 || y < 1 || y > 9) {
    throw new ImageHashUsageError(
      `--components must look like 4x3, each side from 1 to 9 (got "${value}")`,
    )
  }
  return { x, y }
}

export function parseSampleSize(value: string): number {
  const size = Number(value)
  if (!Number.isInteger(size) || size < 1 || size > MAX_SAMPLE_SIZE) {
    throw new ImageHashUsageError(
      `--size must be a whole number from 1 to ${MAX_SAMPLE_SIZE} (got "${value}")`,
    )
  }
  return size
}

export function parseExtensions(value: string): string[] {
  return value
    .split(',')
    .map((ext) => ext.trim())
    .filter(Boolean)
    .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`).toLowerCase())
}

export function withUpperCaseVariants(extensions: string[]): string[] {
  return [...new Set(extensions.flatMap((ext) => [ext, ext.toUpperCase()]))]
}

export function validateExportName(name: string): string {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
    throw new ImageHashUsageError(`--name must be a valid identifier (got "${name}")`)
  }
  return name
}

export function splitPathArguments(
  args: string[],
  exists: (path: string) => boolean = existsSync,
): string[] {
  const out: string[] = []
  for (const arg of args) {
    if (exists(arg) || !arg.includes(',')) {
      out.push(arg)
      continue
    }
    for (const part of arg.split(',')) {
      const trimmed = part.trim()
      if (trimmed) out.push(trimmed)
    }
  }
  return out
}

export function defaultOutExtension(format: OutputFormat): string {
  return format === 'plain' ? '.txt' : `.${format}`
}

export function normalizeOutExtension(value: string | undefined, format: OutputFormat): string {
  if (value === undefined) return defaultOutExtension(format)
  const trimmed = value.trim()
  if (trimmed === '') return ''
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
}

export function validateSuffix(
  suffix: string | undefined,
  types: HashType[],
  format: OutputFormat,
) {
  const resolved = suffix ?? '.{type}'
  if (format === 'plain' && types.length === 2 && !resolved.includes('{type}')) {
    throw new ImageHashUsageError(
      '--suffix must contain {type} when --format plain writes both hashes per image, ' +
        'otherwise the two files would overwrite each other',
    )
  }
  return resolved
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function structured(entry: HashEntry, types: HashType[]): Record<string, string | number> {
  const out: Record<string, string | number> = { width: entry.width, height: entry.height }
  for (const type of types) {
    const hash = entry[type]
    if (hash !== undefined) out[type] = hash
  }
  return out
}

function csvHeader(types: HashType[], withFile: boolean): string {
  return [...(withFile ? ['file'] : []), 'width', 'height', ...types].join(',')
}

function csvRow(entry: HashEntry, types: HashType[], withFile: boolean): string {
  return [
    ...(withFile ? [csvField(entry.file)] : []),
    String(entry.width),
    String(entry.height),
    ...types.map((type) => csvField(entry[type] ?? '')),
  ].join(',')
}

export function formatAggregate(
  entries: HashEntry[],
  types: HashType[],
  format: OutputFormat,
  exportName: string,
): string {
  if (format === 'csv') {
    return [csvHeader(types, true), ...entries.map((e) => csvRow(e, types, true))].join('\n') + '\n'
  }
  if (format === 'plain') {
    return (
      entries.map((e) => [e.file, ...types.map((type) => e[type] ?? '')].join('\t')).join('\n') +
      (entries.length > 0 ? '\n' : '')
    )
  }
  const map: Record<string, Record<string, string | number>> = {}
  for (const entry of entries) map[entry.file] = structured(entry, types)
  const json = JSON.stringify(map, null, 2)
  if (format === 'json') return `${json}\n`
  const suffix = format === 'ts' ? ' as const' : ''
  return `export const ${exportName} = ${json}${suffix}\n`
}

export function formatPerFile(
  entry: HashEntry,
  types: HashType[],
  format: OutputFormat,
): OutputUnit[] {
  if (format === 'plain') {
    return types.map((type) => ({ token: type, content: entry[type] ?? '' }))
  }
  const token = types.length === 2 ? 'hash' : (types[0] as HashType)
  const object = structured(entry, types)
  if (format === 'csv') {
    return [{ token, content: `${csvHeader(types, false)}\n${csvRow(entry, types, false)}\n` }]
  }
  const json = JSON.stringify(object, null, 2)
  if (format === 'json') return [{ token, content: `${json}\n` }]
  const suffix = format === 'ts' ? ' as const' : ''
  return [{ token, content: `export default ${json}${suffix}\n` }]
}

export function outputFileName(
  imagePath: string,
  suffix: string,
  token: string,
  extension: string,
): string {
  return `${basename(imagePath)}${suffix.replace(/\{type\}/g, token)}${extension}`
}
