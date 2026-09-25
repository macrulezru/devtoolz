import { basename, dirname, join, relative, resolve } from 'node:path'
import { walk } from '../../utils/walk.js'
import {
  parseTestFile,
  hasMatchingSource,
  candidateSourceDirs,
  type OrphanTestFinding,
} from './core.js'

const DEFAULT_TEST_SUFFIXES = ['.test', '.spec']
const DEFAULT_SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue']
const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

export interface OrphanTestsRunOptions {
  paths: string[]
  cwd: string
  /** which files to consider as POSSIBLE test files while walking — default: .ts,.tsx,.js,.jsx,.mjs,.cjs */
  extensions?: string[]
  ignoreGlobs?: string[]
  respectGitignore?: boolean
  /** suffix(es) that mark a file as a test file — default: ['.test', '.spec'] */
  testSuffixes?: string[]
  /** extensions tried for a matching source file — default: .ts,.tsx,.js,.jsx,.mjs,.cjs,.vue */
  sourceExtensions?: string[]
  /** mirrored layout: source root, relative to `cwd` — must be given together with `testDir` */
  sourceDir?: string
  /** mirrored layout: test root, relative to `cwd` — must be given together with `sourceDir` */
  testDir?: string
}

export interface OrphanTestsReport {
  filesScanned: number
  findings: OrphanTestFinding[]
  /** --source-dir/--test-dir given without its pair — a different kind of problem than any single finding */
  error: string | null
  exitCode: number
}

export function runOrphanTests(options: OrphanTestsRunOptions): OrphanTestsReport {
  const cwd = resolve(options.cwd)
  const testSuffixes = options.testSuffixes ?? DEFAULT_TEST_SUFFIXES
  const sourceExtensions = options.sourceExtensions ?? DEFAULT_SOURCE_EXTENSIONS
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS

  if (Boolean(options.sourceDir) !== Boolean(options.testDir)) {
    return {
      filesScanned: 0,
      findings: [],
      error: '--source-dir and --test-dir must be given together',
      exitCode: 1,
    }
  }

  const mirrored = Boolean(options.sourceDir && options.testDir)
  const walkRoots = mirrored ? [options.testDir as string] : options.paths

  const testFiles = walk(walkRoots, {
    cwd,
    extensions,
    ignoreGlobs: options.ignoreGlobs ?? [],
    ...(options.respectGitignore !== undefined
      ? { respectGitignore: options.respectGitignore }
      : {}),
  })

  const testDirAbs = mirrored ? resolve(cwd, options.testDir as string) : null
  const sourceDirAbs = mirrored ? resolve(cwd, options.sourceDir as string) : null

  const findings: OrphanTestFinding[] = []
  for (const absFile of testFiles) {
    const parsed = parseTestFile(basename(absFile), testSuffixes)
    if (!parsed) continue

    const found =
      mirrored && testDirAbs && sourceDirAbs
        ? hasMatchingSource(
            join(sourceDirAbs, relative(testDirAbs, dirname(absFile)), parsed.base),
            sourceExtensions,
          )
        : candidateSourceDirs(dirname(absFile)).some((dir) =>
            hasMatchingSource(join(dir, parsed.base), sourceExtensions),
          )

    if (found) continue
    findings.push({
      file: relative(cwd, absFile).split('\\').join('/'),
      triedExtensions: sourceExtensions,
    })
  }

  findings.sort((a, b) => a.file.localeCompare(b.file))

  return {
    filesScanned: testFiles.length,
    findings,
    error: null,
    exitCode: findings.length > 0 ? 1 : 0,
  }
}
