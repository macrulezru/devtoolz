import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runUnusedDeps } from '../commands/unused-deps/run.js'

describe('runUnusedDeps', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'devtoolz-unused-deps-'))
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

  it('reports no findings when every declared dependency is imported', () => {
    writePkg({ name: 'pkg', dependencies: { lodash: '^4.0.0' } })
    write('src/index.ts', "import { debounce } from 'lodash'\nconsole.log(debounce)\n")
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([])
    expect(report.exitCode).toBe(0)
  })

  it('flags a declared dependency nothing imports', () => {
    writePkg({ name: 'pkg', dependencies: { lodash: '^4.0.0' } })
    write('src/index.ts', 'console.log(1)\n')
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([{ kind: 'unused', name: 'lodash', section: 'dependencies' }])
    expect(report.exitCode).toBe(1)
  })

  it('resolves the real package name from a scoped subpath import', () => {
    writePkg({ name: 'pkg', dependencies: { '@scope/kit': '^1.0.0' } })
    write('src/index.ts', "import { x } from '@scope/kit/sub/path.js'\nconsole.log(x)\n")
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('resolves the real package name from an unscoped subpath import', () => {
    writePkg({ name: 'pkg', dependencies: { lodash: '^4.0.0' } })
    write('src/index.ts', "import debounce from 'lodash/debounce.js'\nconsole.log(debounce)\n")
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('never flags a Node builtin as unused or phantom', () => {
    writePkg({ name: 'pkg' })
    write('src/index.ts', "import { readFileSync } from 'node:fs'\nconsole.log(readFileSync)\n")
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('counts an `import type` as usage', () => {
    writePkg({ name: 'pkg', devDependencies: { typescript: '^5.0.0' } })
    write(
      'src/index.ts',
      "import type { CompilerOptions } from 'typescript'\nexport type X = CompilerOptions\n",
    )
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('flags a used package that is not declared anywhere in package.json (phantom)', () => {
    writePkg({ name: 'pkg' })
    write('src/index.ts', "import { x } from 'ghost-pkg'\nconsole.log(x)\n")
    write('node_modules/ghost-pkg/package.json', JSON.stringify({ name: 'ghost-pkg' }))
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]).toMatchObject({ kind: 'phantom', name: 'ghost-pkg' })
    expect(report.findings[0]?.resolvedFrom).toContain('ghost-pkg')
  })

  it('does not flag a used-but-undeclared package that fails to resolve on disk at all (a different, broken-import problem)', () => {
    writePkg({ name: 'pkg' })
    write('src/index.ts', "import { x } from 'totally-missing'\nconsole.log(x)\n")
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('exempts @types/* packages from the unused check by default (ambient, never imported by name)', () => {
    writePkg({ name: 'pkg', devDependencies: { '@types/node': '^20.0.0' } })
    write('src/index.ts', 'console.log(1)\n')
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('--strict also checks @types/* packages', () => {
    writePkg({ name: 'pkg', devDependencies: { '@types/node': '^20.0.0' } })
    write('src/index.ts', 'console.log(1)\n')
    const report = runUnusedDeps({ dir: root, strict: true })
    expect(report.findings).toEqual([
      { kind: 'unused', name: '@types/node', section: 'devDependencies' },
    ])
  })

  it('does not flag a devDependency invoked only via an npm script, by its package name', () => {
    writePkg({
      name: 'pkg',
      devDependencies: { vitest: '^3.0.0' },
      scripts: { test: 'vitest run' },
    })
    write('src/index.ts', 'console.log(1)\n')
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('does not flag a devDependency invoked via a bin name that differs from its package name', () => {
    writePkg({
      name: 'pkg',
      devDependencies: { typescript: '^5.0.0' },
      scripts: { build: 'tsc -p tsconfig.json' },
    })
    write(
      'node_modules/typescript/package.json',
      JSON.stringify({ name: 'typescript', bin: { tsc: './bin/tsc' } }),
    )
    write('src/index.ts', 'console.log(1)\n')
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('never flags peerDependencies as unused', () => {
    writePkg({ name: 'pkg', peerDependencies: { vue: '^3.0.0' } })
    write('src/index.ts', 'console.log(1)\n')
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('does not flag a used peerDependency as phantom', () => {
    writePkg({ name: 'pkg', peerDependencies: { vue: '^3.0.0' } })
    write('src/index.ts', "import { ref } from 'vue'\nconsole.log(ref)\n")
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('--ignore-package exempts a specific dependency from both directions', () => {
    writePkg({ name: 'pkg', dependencies: { 'husky-hook-only': '^1.0.0' } })
    write('src/index.ts', 'console.log(1)\n')
    const report = runUnusedDeps({
      dir: root,
      ignorePackages: ['husky-hook-only'],
    })
    expect(report.findings).toEqual([])
  })

  it('reports a clean error, not a crash, when no package.json exists', () => {
    write('src/index.ts', 'console.log(1)\n')
    const report = runUnusedDeps({ dir: root })
    expect(report.error).not.toBeNull()
    expect(report.exitCode).toBe(1)
  })

  it('does not flag a package importing its own published name as phantom (self-reference)', () => {
    writePkg({ name: '@scope/widget-kit', exports: { '.': './src/index.ts' } })
    write(
      'src/index.ts',
      "import { helper } from '@scope/widget-kit/helper.js'\nconsole.log(helper)\n",
    )
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('does not flag a devDependency invoked only from the lint-staged field of package.json', () => {
    writePkg({
      name: 'pkg',
      devDependencies: { prettier: '^3.0.0' },
      'lint-staged': { '*.ts': ['prettier --write'] },
    })
    write('src/index.ts', 'console.log(1)\n')
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('does not flag a devDependency referenced only as a string value in vitest.config.ts', () => {
    writePkg({ name: 'pkg', devDependencies: { 'happy-dom': '^15.0.0' } })
    write('vitest.config.ts', "export default { test: { environment: 'happy-dom' } }\n")
    write('src/index.ts', 'console.log(1)\n')
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('does not flag typescript as unused by default (near-universally implicit)', () => {
    writePkg({ name: 'pkg', devDependencies: { typescript: '^5.0.0' } })
    write('src/index.ts', 'console.log(1)\n')
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('does not flag @nuxt/schema as unused (ambient Nuxt module types, same class as @types/*)', () => {
    writePkg({ name: 'pkg', devDependencies: { '@nuxt/schema': '^4.0.0' } })
    write('src/index.ts', 'console.log(1)\n')
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('does not flag postcss/sass as unused (Vite auto-detects them by installation, never by name)', () => {
    writePkg({ name: 'pkg', devDependencies: { postcss: '^8.0.0', sass: '^1.0.0' } })
    write('src/index.ts', 'console.log(1)\n')
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('does not flag a devDependency referenced as a bare object key in postcss.config.js', () => {
    writePkg({ name: 'pkg', devDependencies: { autoprefixer: '^10.0.0' } })
    write('postcss.config.js', 'export default { plugins: { autoprefixer: {} } }\n')
    write('src/index.ts', 'console.log(1)\n')
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('does not confuse a bare config reference with a different package that merely contains it as a substring', () => {
    writePkg({ name: 'pkg', devDependencies: { autoprefixer: '^10.0.0' } })
    write('postcss.config.js', 'export default { plugins: { "autoprefixer-wrapper": {} } }\n')
    write('src/index.ts', 'console.log(1)\n')
    const report = runUnusedDeps({ dir: root })
    expect(report.findings).toEqual([
      { kind: 'unused', name: 'autoprefixer', section: 'devDependencies' },
    ])
  })

  it('--strict also checks typescript and @vitest/coverage-* now that they are structurally-implicit exemptions', () => {
    writePkg({
      name: 'pkg',
      devDependencies: { typescript: '^5.0.0', '@vitest/coverage-v8': '^3.0.0' },
    })
    write('src/index.ts', 'console.log(1)\n')
    const report = runUnusedDeps({ dir: root, strict: true })
    expect(report.findings).toEqual([
      { kind: 'unused', name: '@vitest/coverage-v8', section: 'devDependencies' },
      { kind: 'unused', name: 'typescript', section: 'devDependencies' },
    ])
  })
})
