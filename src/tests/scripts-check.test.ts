import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runScriptsCheck } from '../commands/scripts-check/run.js'

describe('runScriptsCheck', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'devtoolz-scripts-check-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function write(relPath: string, content: string): void {
    const full = join(root, relPath)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }

  function writePkg(scripts: Record<string, string>): void {
    write('package.json', JSON.stringify({ name: 'demo', scripts }, null, 2))
  }

  it('flags a README mention of a script that does not exist in package.json', () => {
    writePkg({ build: 'tsc' })
    write('README.md', ['Run it with:', '', '```bash', 'npm run buld', '```'].join('\n'))
    const report = runScriptsCheck({ dir: root })
    expect(report.findings).toContainEqual(
      expect.objectContaining({ kind: 'missing', name: 'buld', file: 'README.md' }),
    )
    expect(report.exitCode).toBe(1)
  })

  it('does not flag a script that is both declared and documented', () => {
    writePkg({ build: 'tsc' })
    write('README.md', ['```bash', 'npm run build', '```'].join('\n'))
    const report = runScriptsCheck({ dir: root })
    expect(report.findings).toEqual([])
    expect(report.exitCode).toBe(0)
  })

  it('flags a declared script nothing documents', () => {
    writePkg({ build: 'tsc', 'internal-helper': 'node ./scripts/helper.js' })
    write('README.md', ['```bash', 'npm run build', '```'].join('\n'))
    const report = runScriptsCheck({ dir: root })
    expect(report.findings).toEqual([
      {
        kind: 'undocumented',
        name: 'internal-helper',
        file: 'package.json',
        line: expect.any(Number),
      },
    ])
  })

  it('does not flag npm lifecycle scripts as undocumented', () => {
    writePkg({
      build: 'tsc',
      prepublishOnly: 'npm run build',
      preinstall: 'node ./check-node-version.js',
      prepare: 'husky install',
      prebuild: 'rimraf dist',
    })
    write('README.md', ['```bash', 'npm run build', '```'].join('\n'))
    const report = runScriptsCheck({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('recognizes npm test/npm start without "run"', () => {
    writePkg({ test: 'vitest run', start: 'node dist/index.js' })
    write('README.md', ['```bash', 'npm test', 'npm start', '```'].join('\n'))
    const report = runScriptsCheck({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('recognizes yarn/pnpm bare script invocation for direction 2, but not for direction 1', () => {
    writePkg({ lint: 'eslint .' })
    write('README.md', ['```bash', 'yarn lint', '```'].join('\n'))
    const report = runScriptsCheck({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('does not extract an unrelated yarn/pnpm subcommand as a missing script mention', () => {
    writePkg({ build: 'tsc' })
    write('README.md', ['```bash', 'yarn add lodash', 'pnpm install', '```'].join('\n'))
    const report = runScriptsCheck({ dir: root })
    expect(report.findings.filter((f) => f.kind === 'missing')).toEqual([])
  })

  it('checks .github/workflows/*.yml as a source too', () => {
    writePkg({ build: 'tsc', test: 'vitest run' })
    write('README.md', ['```bash', 'npm run build', '```'].join('\n'))
    write(
      '.github/workflows/ci.yml',
      ['jobs:', '  test:', '    steps:', '      - run: npm test'].join('\n'),
    )
    const report = runScriptsCheck({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('flags a CI workflow mention of a script that does not exist', () => {
    writePkg({ build: 'tsc' })
    write('README.md', ['```bash', 'npm run build', '```'].join('\n'))
    write(
      '.github/workflows/ci.yml',
      ['jobs:', '  ci:', '    steps:', '      - run: npm run lint'].join('\n'),
    )
    const report = runScriptsCheck({ dir: root })
    expect(report.findings).toEqual([
      { kind: 'missing', name: 'lint', file: '.github/workflows/ci.yml', line: 4 },
    ])
  })

  it('does not flag a CI step run under a different working-directory — a different package.json entirely', () => {
    writePkg({ build: 'tsc', test: 'vitest run' })
    write('README.md', ['```bash', 'npm run build', 'npm test', '```'].join('\n'))
    write(
      '.github/workflows/ci.yml',
      [
        'jobs:',
        '  e2e:',
        '    steps:',
        '      - run: npm ci',
        '        working-directory: demo',
        '      - run: npm run test:e2e',
        '        working-directory: demo',
      ].join('\n'),
    )
    const report = runScriptsCheck({ dir: root })
    expect(report.findings).toEqual([])
  })

  it('checks an explicit --file in addition to the default README.md', () => {
    writePkg({ build: 'tsc', deploy: 'node ./deploy.js' })
    write('README.md', ['```bash', 'npm run build', '```'].join('\n'))
    write('docs/deploying.md', ['```bash', 'npm run deploy', '```'].join('\n'))
    const report = runScriptsCheck({ dir: root, files: ['README.md', 'docs/deploying.md'] })
    expect(report.findings).toEqual([])
  })

  it('reports an error when package.json is missing', () => {
    const report = runScriptsCheck({ dir: root })
    expect(report.error).toMatch(/could not read package\.json/)
    expect(report.exitCode).toBe(1)
  })

  it('reports no findings for a fully honest package', () => {
    writePkg({ build: 'tsc', test: 'vitest run', prepublishOnly: 'npm run build' })
    write('README.md', ['```bash', 'npm run build', 'npm test', '```'].join('\n'))
    const report = runScriptsCheck({ dir: root })
    expect(report.findings).toEqual([])
    expect(report.exitCode).toBe(0)
  })
})
