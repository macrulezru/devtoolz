import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runDeadExports } from '../commands/dead-exports/run.js'

describe('runDeadExports', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'devtoolz-dead-exports-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function write(relPath: string, content: string): void {
    const full = join(root, relPath)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }

  function names(findings: { name: string }[]): string[] {
    return findings.map((f) => f.name).sort()
  }

  it('flags a named export nothing imports', () => {
    write('src/foo.ts', 'export const unused = 1\n')
    const report = runDeadExports({ paths: ['src'], cwd: root, workspace: false })
    expect(names(report.findings)).toEqual(['unused'])
    expect(report.exitCode).toBe(1)
  })

  it('excludes build-tool config files (*.config.ts) from the scan by default', () => {
    // Confirmed against a real project (inview) — a tsup/vitest config's
    // default export is loaded by that tool's own CLI via filename
    // convention, never through an in-repo `import`, so it always LOOKS
    // dead to static analysis. Excluded outright rather than reported.
    // `real` deliberately lives in a non-entry file, so its exemption
    // can't be coming from the separate src/index.ts auto-entry default —
    // filesScanned is checked directly too, to prove the config file was
    // excluded from the walk, not just from the findings.
    write('tsup.config.ts', 'export default { entry: ["src/index.ts"] }\n')
    write('src/other.ts', 'export const real = 1\n')
    write('src/consumer.ts', "import { real } from './other.js'\nconsole.log(real)\n")
    const report = runDeadExports({ paths: ['.'], cwd: root, workspace: false })
    expect(report.filesScanned).toBe(2)
    expect(report.findings).toEqual([])
  })

  it('does not flag an export that is actually imported', () => {
    write('src/foo.ts', 'export const used = 1\n')
    write('src/bar.ts', "import { used } from './foo.js'\nconsole.log(used)\n")
    const report = runDeadExports({ paths: ['src'], cwd: root, workspace: false })
    expect(report.findings).toEqual([])
    expect(report.exitCode).toBe(0)
  })

  it('resolves NodeNext-style .js specifiers back to the real .ts file', () => {
    write('src/foo.ts', 'export const used = 1\n')
    write('src/bar.ts', "export { used } from './foo.js'\n")
    write('src/main.ts', "import { used } from './bar.js'\nconsole.log(used)\n")
    const report = runDeadExports({ paths: ['src'], cwd: root, workspace: false })
    expect(report.findings).toEqual([])
  })

  it('traces a named reexport chain to the real origin file', () => {
    // `barrel.ts`, not `index.ts` — see the note on the "still flags a
    // dead export..." test below for why that name is avoided here.
    write('src/foo.ts', 'export const helper = 1\n')
    write('src/barrel.ts', "export { helper } from './foo.js'\n")
    write('src/consumer.ts', "import { helper } from './barrel.js'\nconsole.log(helper)\n")
    const report = runDeadExports({ paths: ['src'], cwd: root, workspace: false })
    expect(report.findings).toEqual([])
  })

  it('traces a star reexport chain', () => {
    write('src/foo.ts', 'export const helper = 1\n')
    write('src/barrel.ts', "export * from './foo.js'\n")
    write('src/consumer.ts', "import { helper } from './barrel.js'\nconsole.log(helper)\n")
    const report = runDeadExports({ paths: ['src'], cwd: root, workspace: false })
    expect(report.findings).toEqual([])
  })

  it('still flags a dead export reachable only through an unused reexport barrel', () => {
    // Named `barrel.ts`, not `index.ts` — deliberately avoiding the
    // separate "src/index.ts is a public entry by default" heuristic,
    // which would otherwise exempt everything it re-exports and mask
    // what this test actually checks: that a star-reexport correctly
    // propagates usage per-symbol, not "the barrel got imported at all".
    write('src/foo.ts', 'export const helper = 1\nexport const dead = 2\n')
    write('src/barrel.ts', "export * from './foo.js'\n")
    write('src/consumer.ts', "import { helper } from './barrel.js'\nconsole.log(helper)\n")
    const report = runDeadExports({ paths: ['src'], cwd: root, workspace: false })
    expect(names(report.findings)).toEqual(['dead'])
  })

  it('counts a type-only import as usage', () => {
    write('src/types.ts', 'export type Thing = number\n')
    write(
      'src/consumer.ts',
      "import type { Thing } from './types.js'\nconst x: Thing = 1\nconsole.log(x)\n",
    )
    const report = runDeadExports({ paths: ['src'], cwd: root, workspace: false })
    expect(report.findings).toEqual([])
  })

  it('counts any default import as usage of the default export', () => {
    write('src/foo.ts', 'export default function foo() {}\n')
    write('src/consumer.ts', "import anyLocalName from './foo.js'\nanyLocalName()\n")
    const report = runDeadExports({ paths: ['src'], cwd: root, workspace: false })
    expect(report.findings).toEqual([])
  })

  it('marks every export of a namespace-imported file as used', () => {
    write('src/foo.ts', 'export const a = 1\nexport const b = 2\n')
    write('src/consumer.ts', "import * as ns from './foo.js'\nconsole.log(ns)\n")
    const report = runDeadExports({ paths: ['src'], cwd: root, workspace: false })
    expect(report.findings).toEqual([])
  })

  it('exempts a package.json-declared public entry point by default', () => {
    write('package.json', JSON.stringify({ name: 'pkg', main: './dist/index.js' }))
    write('src/index.ts', 'export const publicApi = 1\n')
    const report = runDeadExports({ paths: ['src'], cwd: root, workspace: false })
    expect(report.findings).toEqual([])
  })

  it('a named reexport barrel exempts only the re-exported symbol, not every other export in that file', () => {
    write('package.json', JSON.stringify({ name: 'pkg', main: './dist/index.js' }))
    write('src/index.ts', "export { formatPrice } from './pricing.js'\n")
    write(
      'src/pricing.ts',
      [
        'export function formatPrice(cents) {',
        '  return cents',
        '}',
        '',
        'export function roundToNearestNickel(cents) {',
        '  return cents',
        '}',
        '',
      ].join('\n'),
    )
    const report = runDeadExports({ paths: ['src'], cwd: root, workspace: false })
    expect(names(report.findings)).toEqual(['roundToNearestNickel'])
  })

  it('--strict also flags an unused public entry export', () => {
    write('package.json', JSON.stringify({ name: 'pkg', main: './dist/index.js' }))
    write('src/index.ts', 'export const publicApi = 1\n')
    const report = runDeadExports({ paths: ['src'], cwd: root, workspace: false, strict: true })
    expect(names(report.findings)).toEqual(['publicApi'])
  })

  it('does not hang on a circular reexport', () => {
    write('src/a.ts', "export * from './b.js'\n")
    write('src/b.ts', "export * from './a.js'\n")
    const report = runDeadExports({ paths: ['src'], cwd: root, workspace: false })
    expect(report.exitCode).toBe(0)
    expect(report.findings).toEqual([])
  })

  it('flags a dynamic import with a non-literal path as unresolvable without crashing', () => {
    write('src/foo.ts', 'export const dead = 1\n')
    write('src/consumer.ts', 'const p = Math.random() > 0.5 ? "./a" : "./b"\nimport(p)\n')
    const report = runDeadExports({ paths: ['src'], cwd: root, workspace: false })
    expect(report.hasUnresolvableDynamicImports).toBe(true)
    expect(names(report.findings)).toEqual(['dead'])
  })

  it('treats a dynamic import with a literal path as full usage of the target', () => {
    write('src/foo.ts', 'export const lazy = 1\n')
    write('src/consumer.ts', "async function load() { await import('./foo.js') }\nload()\n")
    const report = runDeadExports({ paths: ['src'], cwd: root, workspace: false })
    expect(report.findings).toEqual([])
  })

  it('resolves a sibling workspace package export instead of flagging it dead', () => {
    // --strict, and `shared` declared in a non-entry file re-exported
    // through the barrel — so this only passes if the cross-package
    // import is genuinely traced back to helper.ts, not incidentally
    // exempted by the (disabled, under --strict) public-entry allowance.
    write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n")
    write(
      'packages/core/package.json',
      JSON.stringify({ name: '@scope/core', main: './dist/index.js' }),
    )
    write('packages/core/src/helper.ts', 'export const shared = 1\n')
    write('packages/core/src/index.ts', "export { shared } from './helper.js'\n")
    write(
      'packages/vue/package.json',
      JSON.stringify({ name: '@scope/vue', main: './dist/index.js' }),
    )
    write(
      'packages/vue/src/index.ts',
      "import { shared } from '@scope/core'\nexport const useShared = () => shared\n",
    )

    const report = runDeadExports({ paths: ['packages'], cwd: root, strict: true })
    expect(names(report.findings)).toEqual(['useShared'])
  })
})
