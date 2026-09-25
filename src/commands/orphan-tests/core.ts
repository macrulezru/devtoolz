import { existsSync } from 'node:fs'
import { basename, dirname, extname } from 'node:path'

export interface OrphanTestFinding {
  file: string
  triedExtensions: string[]
}

// A test file's own name, stripped of its test suffix AND extension —
// `Foo.test.ts` with suffixes `['.test', '.spec']` becomes `Foo`. A file
// whose name doesn't end in any configured suffix isn't a test file this
// command recognizes at all (a plain `.ts` file that happened to get
// walked alongside real test files) and is silently skipped, not flagged.
export function parseTestFile(fileName: string, testSuffixes: string[]): { base: string } | null {
  const ext = extname(fileName)
  if (!ext) return null
  const withoutExt = fileName.slice(0, fileName.length - ext.length)
  for (const suffix of testSuffixes) {
    if (withoutExt.endsWith(suffix)) {
      return { base: withoutExt.slice(0, withoutExt.length - suffix.length) }
    }
  }
  return null
}

export function hasMatchingSource(sourceBaseAbsPath: string, sourceExtensions: string[]): boolean {
  return sourceExtensions.some((ext) => existsSync(`${sourceBaseAbsPath}${ext}`))
}

// Real dogfooding against this very workspace's own packages found that
// strict same-directory co-location (`Foo.test.ts` next to `Foo.ts`) is
// the MINORITY case — most instead put the test one level down, in a
// `__tests__`/`tests` sibling of the real source directory
// (`src/adapters/__tests__/http.test.ts` next to `src/adapters/http.ts`).
// Treating that as a second co-located candidate — not a `--source-dir`/
// `--test-dir` mirror, since it's still ONE tree, just with tests one
// level deeper — turns the default mode from "barely applicable to real
// projects" into the common case it should be, without a new flag: this
// container-name list is stable convention, not a per-project setting.
const TEST_CONTAINER_DIR_NAMES = new Set(['__tests__', 'tests', 'test', 'spec', 'specs'])

export function candidateSourceDirs(testFileDir: string): string[] {
  const dirs = [testFileDir]
  const parent = dirname(testFileDir)
  if (TEST_CONTAINER_DIR_NAMES.has(basename(testFileDir)) && parent !== testFileDir) {
    dirs.push(parent)
  }
  return dirs
}
