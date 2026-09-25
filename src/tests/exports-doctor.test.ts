import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runExportsDoctor } from '../commands/exports-doctor/run.js'

describe('runExportsDoctor', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'devtoolz-exports-doctor-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function write(relPath: string, content: string): void {
    const full = join(root, relPath)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }

  function writePkg(pkg: Record<string, unknown>): void {
    write('package.json', JSON.stringify(pkg))
  }

  it('reports no findings when every declared path resolves', () => {
    write('dist/index.js', '')
    writePkg({ name: 'pkg', main: './dist/index.js' })
    const report = runExportsDoctor({ dir: root })
    expect(report.findings).toEqual([])
    expect(report.exitCode).toBe(0)
  })

  it('flags a missing main entry', () => {
    writePkg({ name: 'pkg', main: './dist/index.js' })
    const report = runExportsDoctor({ dir: root })
    expect(report.findings).toEqual([
      { location: 'main', path: './dist/index.js', kind: 'missing' },
    ])
    expect(report.exitCode).toBe(1)
  })

  it('flags a case mismatch and reports the real path', () => {
    write('dist/Index.js', '')
    writePkg({ name: 'pkg', main: './dist/index.js' })
    const report = runExportsDoctor({ dir: root })
    expect(report.findings).toEqual([
      {
        location: 'main',
        path: './dist/index.js',
        kind: 'case-mismatch',
        realPath: './dist/Index.js',
      },
    ])
  })

  it('resolves a conditions-object exports map (single "." entry, no subpaths)', () => {
    write('dist/index.js', '')
    write('dist/index.d.ts', '')
    writePkg({
      name: 'pkg',
      exports: { types: './dist/index.d.ts', import: './dist/index.js' },
    })
    const report = runExportsDoctor({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('resolves a subpaths exports map, one entry per subpath', () => {
    write('dist/index.js', '')
    write('dist/cdn/index.js', '')
    writePkg({
      name: 'pkg',
      exports: {
        '.': './dist/index.js',
        './cdn': './dist/cdn/index.js',
      },
    })
    const report = runExportsDoctor({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('catches the real entryRoot-class bug: runtime resolves, types for the same subpath were never declared', () => {
    // The exact bug pattern found by hand in vite.cdn.config.ts (missing
    // entryRoot) — the .js exists and resolves, but nothing under
    // exports["./cdn"] even MENTIONS types, so a TS consumer gets no
    // error anywhere, just silently no type information.
    write('dist/cdn/index.js', '')
    writePkg({
      name: 'pkg',
      exports: { './cdn': { import: './dist/cdn/index.js' } },
    })
    const report = runExportsDoctor({ dir: root })
    expect(report.findings).toEqual([
      { location: 'exports["./cdn"]', path: './dist/cdn/index.js', kind: 'types-missing' },
    ])
  })

  it('does not flag types-missing when types IS declared, even if that types file is separately missing', () => {
    // The types field being missing on disk is ALREADY its own 'missing'
    // finding — this must not also produce a redundant types-missing one.
    write('dist/cdn/index.js', '')
    writePkg({
      name: 'pkg',
      exports: { './cdn': { import: './dist/cdn/index.js', types: './dist/cdn/index.d.ts' } },
    })
    const report = runExportsDoctor({ dir: root })
    expect(report.findings).toEqual([
      { location: 'exports["./cdn"].types', path: './dist/cdn/index.d.ts', kind: 'missing' },
    ])
  })

  it('flags a bin entry with no shebang', () => {
    write('dist/cli.js', 'console.log("hi")\n')
    writePkg({ name: 'pkg', bin: { pkg: './dist/cli.js' } })
    const report = runExportsDoctor({ dir: root })
    expect(report.findings).toEqual([
      { location: 'bin.pkg', path: './dist/cli.js', kind: 'missing-shebang' },
    ])
  })

  it('does not flag a bin entry that has a shebang', () => {
    write('dist/cli.js', '#!/usr/bin/env node\nconsole.log("hi")\n')
    writePkg({ name: 'pkg', bin: { pkg: './dist/cli.js' } })
    const report = runExportsDoctor({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('supports a string-form bin field', () => {
    write('dist/cli.js', 'console.log("hi")\n')
    writePkg({ name: 'pkg', bin: './dist/cli.js' })
    const report = runExportsDoctor({ dir: root })
    expect(report.findings).toEqual([
      { location: 'bin', path: './dist/cli.js', kind: 'missing-shebang' },
    ])
  })

  it('checks a fallback array, flagging whichever candidate is actually broken', () => {
    write('dist/index.mjs', '')
    writePkg({
      name: 'pkg',
      exports: { '.': ['./dist/index.mjs', './dist/index.js'] },
    })
    const report = runExportsDoctor({ dir: root })
    expect(report.findings).toEqual([
      { location: 'exports["."]', path: './dist/index.js', kind: 'missing' },
    ])
  })

  it('flags types-missing even when the condition is a fallback array (no candidate is types)', () => {
    write('dist/index.mjs', '')
    write('dist/index.js', '')
    writePkg({
      name: 'pkg',
      exports: { import: ['./dist/index.mjs', './dist/index.js'] },
    })
    const report = runExportsDoctor({ dir: root })
    expect(report.findings).toEqual([
      { location: 'exports["."]', path: './dist/index.mjs', kind: 'types-missing' },
    ])
  })

  it('reports a clean error, not a crash, when package.json is missing', () => {
    const report = runExportsDoctor({ dir: root })
    expect(report.error).not.toBeNull()
    expect(report.exitCode).toBe(1)
  })
})
