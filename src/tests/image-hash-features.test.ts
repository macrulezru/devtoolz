import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runImageHash } from '../commands/image-hash/run.js'
import { renderImageHashReport } from '../commands/image-hash/report.js'
import { dominantColor } from '../commands/image-hash/hash.js'
import {
  ImageHashUsageError,
  formatAggregate,
  parseAggregate,
  parseComponents,
  parseFileList,
  parseTypes,
  resolveComponents,
  type HashEntry,
} from '../commands/image-hash/core.js'
import type { SharpFactory } from '../commands/image-hash/sharp-loader.js'

type CreateImage = (options: unknown) => {
  toFile(path: string): Promise<unknown>
  png(): { toBuffer(): Promise<Uint8Array> }
}

const realSharp = createRequire(import.meta.url)('sharp') as CreateImage & SharpFactory
const cliPath = fileURLToPath(new URL('../cli.ts', import.meta.url))
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href

function solid(width: number, height: number, r: number, g: number, b: number) {
  return realSharp({ create: { width, height, channels: 4, background: { r, g, b, alpha: 1 } } })
}

describe('image-hash parsing helpers', () => {
  it('parses a type list, both and all in canonical order', () => {
    expect(parseTypes('color,blurhash')).toEqual(['blurhash', 'color'])
    expect(parseTypes('both')).toEqual(['blurhash', 'thumbhash'])
    expect(parseTypes('all')).toEqual(['blurhash', 'thumbhash', 'color', 'preview'])
    expect(() => parseTypes('blurhash,md5')).toThrow(ImageHashUsageError)
    expect(() => parseTypes(' , ')).toThrow(ImageHashUsageError)
  })

  it('picks blurhash components by aspect ratio when asked to', () => {
    expect(parseComponents('auto')).toBe('auto')
    expect(resolveComponents('auto', 1600, 900)).toEqual({ x: 4, y: 3 })
    expect(resolveComponents('auto', 900, 1600)).toEqual({ x: 3, y: 4 })
    expect(resolveComponents('auto', 100, 100)).toEqual({ x: 4, y: 4 })
    expect(resolveComponents('auto', 300, 100)).toEqual({ x: 4, y: 2 })
    expect(resolveComponents({ x: 5, y: 5 }, 1600, 900)).toEqual({ x: 5, y: 5 })
  })

  it('reads a file list, skipping blank lines and comments', () => {
    expect(parseFileList('a.jpg\r\n\n# note\n  dir/b.png  \nhttps://x.test/c.webp\n')).toEqual([
      'a.jpg',
      'dir/b.png',
      'https://x.test/c.webp',
    ])
  })

  it('finds the dominant opaque color and ignores transparent pixels', () => {
    const pixels = [
      255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0, 0, 255, 0, 0,
    ]
    expect(dominantColor(pixels)).toBe('#ff0000')
    expect(dominantColor([1, 2, 3, 0])).toBeUndefined()
  })

  it('round-trips generated json, ts and csv back into entries', () => {
    const entries: HashEntry[] = [
      { file: 'a.jpg', width: 10, height: 20, blurhash: 'LEHV6nWB2yk8', color: '#ff0000' },
      { file: 'dir/b,c.png', width: 5, height: 5, blurhash: 'LKO2?U%2Tw=w' },
    ]
    for (const format of ['json', 'ts', 'js', 'csv'] as const) {
      const text = formatAggregate(entries, ['blurhash', 'color'], format, 'x')
      expect(parseAggregate(text, format)).toEqual(entries)
    }
  })

  it('refuses to merge into a plain file or one that is not generated output', () => {
    expect(() => parseAggregate('a\tb', 'plain')).toThrow(ImageHashUsageError)
    expect(() => parseAggregate('export const x = nope', 'ts')).toThrow(ImageHashUsageError)
    expect(() => parseAggregate('not json', 'json')).toThrow(ImageHashUsageError)
  })
})

describe('runImageHash extras', () => {
  let root: string

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'devtoolz-image-hash-x-'))
    mkdirSync(join(root, 'img', 'nested'), { recursive: true })
    await solid(200, 100, 255, 0, 0).toFile(join(root, 'img', 'red.jpg'))
    await solid(50, 80, 0, 0, 255).toFile(join(root, 'img', 'blue.png'))
    await solid(30, 30, 0, 200, 0).toFile(join(root, 'img', 'nested', 'green.webp'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('computes the dominant color and a tiny PNG preview', async () => {
    const report = await runImageHash({
      paths: ['img/red.jpg'],
      cwd: root,
      types: ['color', 'preview'],
    })
    const entry = report.entries[0]
    expect(entry?.color).toMatch(/^#f[ef]0000$/)
    expect(entry?.preview?.startsWith('data:image/png;base64,')).toBe(true)
    const png = Buffer.from((entry?.preview ?? '').split(',')[1] ?? '', 'base64')
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(entry?.blurhash).toBeUndefined()
    expect(entry?.thumbhash).toBeUndefined()
  })

  it('uses a different number of blurhash components per aspect ratio with auto', async () => {
    const report = await runImageHash({
      paths: ['img'],
      cwd: root,
      types: ['blurhash'],
      components: 'auto',
    })
    const byFile = Object.fromEntries(report.entries.map((e) => [e.file, e.blurhash ?? '']))
    expect(byFile['img/red.jpg']?.startsWith('L')).toBe(true)
    expect(byFile['img/blue.png']?.startsWith('T')).toBe(true)
  })

  it('makes keys relative to --key-base and adds --key-prefix', async () => {
    const report = await runImageHash({
      paths: ['img'],
      cwd: root,
      types: ['color'],
      keyBase: 'img',
      keyPrefix: '/',
    })
    expect(report.entries.map((e) => e.file)).toEqual(['/blue.png', '/red.jpg'])
  })

  it('skips unchanged images with the cache and does not even load sharp', async () => {
    const first = await runImageHash({
      paths: ['img'],
      cwd: root,
      types: ['blurhash', 'thumbhash'],
      recursive: true,
      cache: '.cache.json',
      sharp: realSharp,
    })
    expect(first.cached).toBe(0)
    expect(existsSync(join(root, '.cache.json'))).toBe(true)

    let sharpCalls = 0
    const spy = Object.assign(
      (...args: Parameters<SharpFactory>) => {
        sharpCalls++
        return realSharp(...args)
      },
      { cache: realSharp.cache },
    ) as SharpFactory
    const second = await runImageHash({
      paths: ['img'],
      cwd: root,
      types: ['blurhash', 'thumbhash'],
      recursive: true,
      cache: '.cache.json',
      sharp: spy,
    })
    expect(second.cached).toBe(3)
    expect(sharpCalls).toBe(0)
    expect(second.entries).toEqual(first.entries)
    expect(renderImageHashReport(second, { plain: true })).toContain('3 from the cache')
  })

  it('recomputes a changed image and one requested with a new type', async () => {
    const base = { paths: ['img'], cwd: root, cache: '.cache.json', recursive: true }
    await runImageHash({ ...base, types: ['blurhash'] })
    await solid(200, 100, 10, 10, 10).toFile(join(root, 'img', 'red.jpg'))
    const second = await runImageHash({ ...base, types: ['blurhash'] })
    expect(second.cached).toBe(2)
    const third = await runImageHash({ ...base, types: ['blurhash', 'color'] })
    expect(third.cached).toBe(0)
    expect(third.entries.every((e) => e.color !== undefined)).toBe(true)
  })

  it('does not write the cache on --dry-run', async () => {
    await runImageHash({
      paths: ['img'],
      cwd: root,
      types: ['blurhash'],
      cache: '.cache.json',
      dryRun: true,
    })
    expect(existsSync(join(root, '.cache.json'))).toBe(false)
  })

  it('checks outputs: up to date, missing and changed', async () => {
    const options = { paths: ['img'], cwd: root, types: ['blurhash' as const], out: 'h.json' }
    const missing = await runImageHash({ ...options, check: true })
    expect(missing.outdated).toEqual([{ file: 'h.json', reason: 'missing' }])
    expect(missing.exitCode).toBe(1)
    expect(existsSync(join(root, 'h.json'))).toBe(false)

    await runImageHash(options)
    const ok = await runImageHash({ ...options, check: true })
    expect(ok.outdated).toEqual([])
    expect(ok.exitCode).toBe(0)
    expect(renderImageHashReport(ok, { plain: true })).toContain('up to date')

    await solid(50, 80, 200, 200, 0).toFile(join(root, 'img', 'blue.png'))
    const changed = await runImageHash({ ...options, check: true })
    expect(changed.outdated).toEqual([{ file: 'h.json', reason: 'changed' }])
    const text = renderImageHashReport(changed, { plain: true })
    expect(text).toContain('out of date')
    expect(text).toContain('differs from the images')
  })

  it('checks per-file outputs one by one', async () => {
    const options = {
      paths: ['img'],
      cwd: root,
      types: ['blurhash' as const],
      format: 'plain' as const,
      perFile: true,
    }
    await runImageHash(options)
    rmSync(join(root, 'img', 'red.jpg.blurhash.txt'))
    const report = await runImageHash({ ...options, check: true })
    expect(report.checked).toBe(2)
    expect(report.outdated).toEqual([{ file: 'img/red.jpg.blurhash.txt', reason: 'missing' }])
  })

  it('rejects --check without an output, with --dry-run and with --update', async () => {
    const base = { paths: ['img'], cwd: root, types: ['blurhash' as const], check: true }
    await expect(runImageHash(base)).rejects.toThrow(/needs the output/)
    await expect(runImageHash({ ...base, out: 'h.json', dryRun: true })).rejects.toThrow(/dry-run/)
    await expect(runImageHash({ ...base, out: 'h.json', update: true })).rejects.toThrow(/update/)
  })

  it('merges into an existing file with --update and drops vanished images with --prune', async () => {
    const options = { cwd: root, types: ['blurhash' as const], out: 'h.json' }
    await runImageHash({ ...options, paths: ['img'] })
    expect(Object.keys(JSON.parse(readFileSync(join(root, 'h.json'), 'utf8')))).toEqual([
      'img/blue.png',
      'img/red.jpg',
    ])

    await solid(20, 20, 1, 2, 3).toFile(join(root, 'img', 'extra.png'))
    const merged = await runImageHash({ ...options, paths: ['img/extra.png'], update: true })
    expect(merged.pruned).toBe(0)
    expect(Object.keys(JSON.parse(readFileSync(join(root, 'h.json'), 'utf8')))).toEqual([
      'img/blue.png',
      'img/extra.png',
      'img/red.jpg',
    ])

    rmSync(join(root, 'img', 'blue.png'))
    const pruned = await runImageHash({
      ...options,
      paths: ['img/extra.png'],
      update: true,
      prune: true,
    })
    expect(pruned.pruned).toBe(1)
    expect(renderImageHashReport(pruned, { plain: true })).toContain('Removed 1 entry')
    expect(Object.keys(JSON.parse(readFileSync(join(root, 'h.json'), 'utf8')))).toEqual([
      'img/extra.png',
      'img/red.jpg',
    ])
  })

  it('keeps hashes of other types that the merged file already holds', async () => {
    const options = { cwd: root, out: 'h.ts', format: 'ts' as const, paths: ['img/red.jpg'] }
    await runImageHash({ ...options, types: ['blurhash'] })
    await runImageHash({ ...options, types: ['color'], update: true })
    const text = readFileSync(join(root, 'h.ts'), 'utf8')
    expect(text).toContain('"blurhash"')
    expect(text).toContain('"color"')
  })

  it('rejects --update without -o and --prune without --update', async () => {
    const base = { paths: ['img'], cwd: root, types: ['blurhash' as const] }
    await expect(runImageHash({ ...base, update: true })).rejects.toThrow(/-o/)
    await expect(runImageHash({ ...base, out: 'h.json', prune: true })).rejects.toThrow(/--update/)
  })

  it('explains a pixel-limit failure and a broken file in plain words', async () => {
    writeFileSync(join(root, 'img', 'broken.jpg'), 'not an image at all')
    const limited = await runImageHash({
      paths: ['img/red.jpg', 'img/broken.jpg'],
      cwd: root,
      types: ['color'],
      maxPixels: 100,
    })
    const messages = Object.fromEntries(limited.errors.map((e) => [e.file, e.message]))
    expect(messages['img/red.jpg']).toMatch(/larger than 100 pixels.*--max-pixels/)
    expect(messages['img/broken.jpg']).toMatch(/not a readable image/)
  })

  it('reports a truncated file instead of hashing garbage', async () => {
    const full = readFileSync(join(root, 'img', 'red.jpg'))
    writeFileSync(join(root, 'img', 'cut.jpg'), full.subarray(0, 300))
    const report = await runImageHash({ paths: ['img/cut.jpg'], cwd: root, types: ['color'] })
    expect(report.entries).toEqual([])
    expect(report.errors[0]?.message).toMatch(/truncated|damaged|not a readable/)
  })

  it('hashes a CMYK jpeg through an sRGB conversion', async () => {
    await realSharp({
      create: { width: 40, height: 40, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .toColourspace('cmyk')
      .jpeg()
      .toFile(join(root, 'img', 'cmyk.jpg'))
    const report = await runImageHash({ paths: ['img/cmyk.jpg'], cwd: root, types: ['color'] })
    expect(report.errors).toEqual([])
    expect(report.entries[0]?.color).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('runImageHash with URLs', () => {
  let server: Server
  let base: string
  let root: string
  let png: Uint8Array

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'devtoolz-image-hash-url-'))
    png = await solid(30, 20, 0, 0, 255).png().toBuffer()
    server = createServer((req, res) => {
      if (req.url === '/pics/blue%20one.png') {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(Buffer.from(png))
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  })

  afterEach(async () => {
    await new Promise((done) => server.close(done))
    rmSync(root, { recursive: true, force: true })
  })

  it('hashes an image downloaded from a URL, keyed by the URL', async () => {
    const url = `${base}/pics/blue%20one.png`
    const report = await runImageHash({ paths: [url], cwd: root, types: ['color'] })
    expect(report.errors).toEqual([])
    expect(report.entries[0]).toMatchObject({ file: url, width: 30, height: 20 })
    expect(report.entries[0]?.color).toMatch(/^#0[0-9a-f]00f[0-9a-f]$/)
  })

  it('reports an HTTP error for a missing URL and keeps the rest', async () => {
    const report = await runImageHash({
      paths: [`${base}/nope.png`, `${base}/pics/blue%20one.png`],
      cwd: root,
      types: ['color'],
    })
    expect(report.entries).toHaveLength(1)
    expect(report.errors[0]?.message).toContain('HTTP 404')
  })

  it('needs --out-dir to write per-image files for a URL, and names the file from the URL', async () => {
    const url = `${base}/pics/blue%20one.png`
    const withoutDir = await runImageHash({
      paths: [url],
      cwd: root,
      types: ['color'],
      perFile: true,
      format: 'plain',
    })
    expect(withoutDir.errors[0]?.message).toMatch(/--out-dir/)

    const withDir = await runImageHash({
      paths: [url],
      cwd: root,
      types: ['color'],
      outDir: 'out',
      format: 'plain',
    })
    expect(withDir.written).toEqual(['out/blue one.png.color.txt'])
    expect(existsSync(join(root, 'out', 'blue one.png.color.txt'))).toBe(true)
  })

  it('does not split a URL that contains a comma', async () => {
    const report = await runImageHash({
      paths: [`${base}/a,b.png`],
      cwd: root,
      types: ['color'],
    })
    expect(report.errors[0]?.file).toBe(`${base}/a,b.png`)
  })
})

describe('image-hash command line', () => {
  let root: string

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'devtoolz-image-hash-cli-'))
    mkdirSync(join(root, 'img'), { recursive: true })
    await solid(200, 100, 255, 0, 0).toFile(join(root, 'img', 'red.jpg'))
    await solid(50, 80, 0, 0, 255).toFile(join(root, 'img', 'blue.png'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function cli(args: string[], input?: string) {
    return spawnSync(process.execPath, ['--import', tsxLoader, cliPath, 'image-hash', ...args], {
      cwd: root,
      encoding: 'utf8',
      input,
      env: { ...process.env, NO_COLOR: '', FORCE_COLOR: '' },
    })
  }

  it('prints json to stdout and exits 0', () => {
    const result = cli(['img', '-t', 'color'])
    expect(result.status).toBe(0)
    expect(Object.keys(JSON.parse(result.stdout))).toEqual(['img/blue.png', 'img/red.jpg'])
  })

  it('exits 2 with a clear message for bad options', () => {
    const result = cli(['img', '-t', 'md5'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--type')
    const check = cli(['img', '--check'])
    expect(check.status).toBe(2)
  })

  it('exits 1 when a path does not exist and still prints the rest', () => {
    const result = cli(['img/red.jpg,nope.png', '-t', 'color'])
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout)['img/red.jpg']).toBeDefined()
    expect(result.stderr).toContain('nope.png')
  })

  it('shows a table with --dry-run and writes nothing', () => {
    const result = cli(['img', '-t', 'color', '--dry-run', '--plain'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('│ File')
    expect(result.stdout).toContain('Color')
    expect(existsSync(join(root, 'img', 'red.jpg.color.json'))).toBe(false)
  })

  it('adds color codes only with --color', () => {
    const plain = cli(['img', '-t', 'color', '--dry-run'])
    expect(plain.stdout).not.toContain(String.fromCharCode(27))
    const colored = cli(['img', '-t', 'color', '--dry-run', '--color'])
    expect(colored.stdout).toContain(String.fromCharCode(27))
  })

  it('reads the path list from stdin with --files-from -', () => {
    const result = cli(['--files-from', '-', '-t', 'color'], '# images\nimg/blue.png\n')
    expect(result.status).toBe(0)
    expect(Object.keys(JSON.parse(result.stdout))).toEqual(['img/blue.png'])
  })

  it('--check exits 1 for stale output and 0 once regenerated', () => {
    expect(cli(['img', '-o', 'h.json', '-t', 'color']).status).toBe(0)
    expect(cli(['img', '-o', 'h.json', '-t', 'color', '--check', '--plain']).status).toBe(0)
    writeFileSync(join(root, 'h.json'), '{}\n')
    const stale = cli(['img', '-o', 'h.json', '-t', 'color', '--check', '--plain'])
    expect(stale.status).toBe(1)
    expect(stale.stdout).toContain('out of date')
  })

  it('uses the default cache file with a bare --cache', () => {
    expect(cli(['img', '-t', 'color', '--cache', '-o', 'h.json']).status).toBe(0)
    expect(existsSync(join(root, '.devtoolz-image-hash-cache.json'))).toBe(true)
    const second = cli(['img', '-t', 'color', '--cache', '-o', 'h.json', '--plain'])
    expect(second.stdout).toContain('2 from the cache')
  })
})
