import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { runCaseCheck } from '../../case-check/run.js'
import { runCircularImports } from '../../circular-imports/run.js'
import { runDeadExports } from '../../dead-exports/run.js'
import { runEmptyCatch } from '../../empty-catch/run.js'
import { runExportsDoctor } from '../../exports-doctor/run.js'
import { runOrphanTests } from '../../orphan-tests/run.js'
import { runReadmeCheck } from '../../readme-check/run.js'
import { runScriptsCheck } from '../../scripts-check/run.js'
import { runStaleTsIgnore } from '../../stale-ts-ignore/run.js'
import { runTodoReport } from '../../todo-report/run.js'
import { runUnusedDeps } from '../../unused-deps/run.js'
import { resolveUserPath } from '../fs-routes.js'
import {
  HttpError,
  asObject,
  sendJson,
  type Route,
  type RouteContext,
  type UiModule,
} from '../http.js'
import { startJob } from '../jobs.js'

export type Severity = 'error' | 'warning' | 'info'

export interface CheckFinding {
  file?: string
  line?: number
  column?: number
  severity: Severity
  code: string
  message: string
  hint?: string
  files?: string[]
}

export interface CheckOutcome {
  summary: string
  filesScanned?: number
  findings: CheckFinding[]
  error?: string
  exitCode: number
  notes?: string[]
}

export interface OptionDef {
  key: string
  label: string
  type: 'boolean' | 'list'
  default: boolean | string
  help: string
}

interface RunInput {
  cwd: string
  flag: (key: string) => boolean
  list: (key: string) => string[]
}

interface CheckDef {
  id: string
  title: string
  description: string
  group: 'dependencies' | 'code' | 'docs'
  slow?: boolean
  options: OptionDef[]
  run: (input: RunInput) => CheckOutcome
}

const COMMON_OPTIONS: OptionDef[] = [
  {
    key: 'ignore',
    label: 'Ignore',
    type: 'list',
    default: '',
    help: 'Extra patterns to skip, one per line (gitignore syntax).',
  },
]

function relativeTo(cwd: string, file: string): string {
  const abs = isAbsolute(file) ? file : resolve(cwd, file)
  const rel = relative(cwd, abs)
  return (rel === '' || rel.startsWith('..') ? abs : rel).split(sep).join('/')
}

function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`
}

const CHECKS: CheckDef[] = [
  {
    id: 'dead-exports',
    title: 'Dead exports',
    description: 'Exports nothing imports: code you can delete or stop exporting.',
    group: 'code',
    options: [
      {
        key: 'strict',
        label: 'Include public entry points',
        type: 'boolean',
        default: false,
        help: 'Also flag exports of the package’s public API, not just internal files.',
      },
      ...COMMON_OPTIONS,
    ],
    run: ({ cwd, flag, list }) => {
      const report = runDeadExports({
        paths: ['.'],
        cwd,
        strict: flag('strict'),
        ignoreGlobs: list('ignore'),
      })
      return {
        summary: `${plural(report.findings.length, 'unused export')} in ${plural(report.filesScanned, 'file')}`,
        filesScanned: report.filesScanned,
        exitCode: report.exitCode,
        findings: report.findings.map((finding) => ({
          file: relativeTo(cwd, finding.file),
          line: finding.line,
          severity: 'warning',
          code: finding.isDefault ? 'default export' : finding.isType ? 'type export' : 'export',
          message: `${finding.isDefault ? 'The default export' : `\`${finding.name}\``} is never imported.`,
          hint: finding.isType
            ? 'A type nobody uses: delete it or stop exporting it.'
            : 'Delete it, or remove the export keyword if it is used inside the file.',
        })),
        ...(report.hasUnresolvableDynamicImports
          ? {
              notes: [
                'Some dynamic imports could not be resolved, so a few findings may be false positives.',
              ],
            }
          : {}),
      }
    },
  },
  {
    id: 'unused-deps',
    title: 'Unused dependencies',
    description:
      'Packages declared in package.json that nothing imports, and imports package.json never declared.',
    group: 'dependencies',
    options: [
      {
        key: 'strict',
        label: 'Include implicit packages',
        type: 'boolean',
        default: false,
        help: 'Also check packages that are usually used without being imported (types, test coverage).',
      },
      {
        key: 'ignorePackages',
        label: 'Ignore packages',
        type: 'list',
        default: '',
        help: 'Package names to leave out, one per line.',
      },
      ...COMMON_OPTIONS,
    ],
    run: ({ cwd, flag, list }) => {
      const report = runUnusedDeps({
        dir: cwd,
        strict: flag('strict'),
        ignorePackages: list('ignorePackages'),
        ignoreGlobs: list('ignore'),
      })
      return {
        summary: report.error
          ? 'Could not read package.json'
          : `${plural(report.findings.length, 'problem')} in ${plural(report.filesScanned, 'file')}`,
        filesScanned: report.filesScanned,
        exitCode: report.exitCode,
        ...(report.error ? { error: report.error } : {}),
        findings: report.findings.map((finding) => ({
          file: 'package.json',
          severity: finding.kind === 'phantom' ? 'error' : 'warning',
          code: finding.kind === 'phantom' ? 'undeclared' : 'unused',
          message:
            finding.kind === 'phantom'
              ? `\`${finding.name}\` is imported but not listed in package.json.`
              : `\`${finding.name}\` is listed${finding.section ? ` in ${finding.section}` : ''} but nothing imports it.`,
          hint:
            finding.kind === 'phantom'
              ? `It only works now because it resolves from ${finding.resolvedFrom ?? 'another package'}. Add it to package.json.`
              : 'Remove it from package.json if nothing else (a config file, a script) needs it.',
        })),
      }
    },
  },
  {
    id: 'empty-catch',
    title: 'Empty catch blocks',
    description: 'catch blocks that swallow errors silently or only log them.',
    group: 'code',
    options: COMMON_OPTIONS,
    run: ({ cwd, list }) => {
      const report = runEmptyCatch({ paths: ['.'], cwd, ignoreGlobs: list('ignore') })
      return {
        summary: `${plural(report.findings.length, 'catch block')} in ${plural(report.filesScanned, 'file')}`,
        filesScanned: report.filesScanned,
        exitCode: report.exitCode,
        findings: report.findings.map((finding) => ({
          file: relativeTo(cwd, finding.file),
          line: finding.line,
          column: finding.column,
          severity: finding.kind === 'empty' ? 'error' : 'warning',
          code: finding.kind,
          message:
            finding.kind === 'empty'
              ? 'This catch block is empty: the error disappears without a trace.'
              : 'This catch block only logs the error to the console.',
          hint: 'Handle the error, rethrow it, or add a comment that says why ignoring it is safe.',
        })),
      }
    },
  },
  {
    id: 'orphan-tests',
    title: 'Orphan tests',
    description: 'Test files whose source file no longer exists.',
    group: 'code',
    options: COMMON_OPTIONS,
    run: ({ cwd, list }) => {
      const report = runOrphanTests({ paths: ['.'], cwd, ignoreGlobs: list('ignore') })
      return {
        summary: `${plural(report.findings.length, 'orphan test')} among ${plural(report.filesScanned, 'file')}`,
        filesScanned: report.filesScanned,
        exitCode: report.exitCode,
        ...(report.error ? { error: report.error } : {}),
        findings: report.findings.map((finding) => ({
          file: relativeTo(cwd, finding.file),
          severity: 'warning',
          code: 'orphan',
          message: 'No source file belongs to this test.',
          hint: `Looked for a matching file with: ${finding.triedExtensions.join(', ')}. Delete the test or restore the source.`,
        })),
      }
    },
  },
  {
    id: 'case-check',
    title: 'Import case',
    description:
      'Imports whose letter case differs from the file on disk: they work on Windows and macOS and break on Linux.',
    group: 'code',
    options: COMMON_OPTIONS,
    run: ({ cwd, list }) => {
      const report = runCaseCheck({ paths: ['.'], cwd, ignoreGlobs: list('ignore') })
      return {
        summary: `${plural(report.findings.length, 'import')} with the wrong case in ${plural(report.filesScanned, 'file')}`,
        filesScanned: report.filesScanned,
        exitCode: report.exitCode,
        findings: report.findings.map((finding) => ({
          file: relativeTo(cwd, finding.file),
          line: finding.line,
          column: finding.column,
          severity: 'error',
          code: finding.isAlias ? 'alias' : 'case',
          message: `"${finding.specifier}" should be "${finding.correctedSpecifier}".`,
          hint: 'Rename the import to match the file name exactly, or Linux CI will fail to find it.',
        })),
      }
    },
  },
  {
    id: 'circular-imports',
    title: 'Circular imports',
    description: 'Files that import each other in a loop.',
    group: 'code',
    options: [
      {
        key: 'includeTypes',
        label: 'Include type-only cycles',
        type: 'boolean',
        default: false,
        help: 'Cycles made only of "import type" are harmless at runtime.',
      },
      ...COMMON_OPTIONS,
    ],
    run: ({ cwd, flag, list }) => {
      const report = runCircularImports({
        paths: ['.'],
        cwd,
        includeTypes: flag('includeTypes'),
        ignoreGlobs: list('ignore'),
      })
      return {
        summary: `${plural(report.findings.length, 'cycle')} in ${plural(report.filesScanned, 'file')}`,
        filesScanned: report.filesScanned,
        exitCode: report.exitCode,
        findings: report.findings.map((finding) => {
          const files = finding.files.map((file) => relativeTo(cwd, file))
          return {
            file: files[0] as string,
            severity: finding.typeOnly ? 'info' : 'error',
            code: finding.typeOnly ? 'type-only' : 'cycle',
            message: [...files, files[0]].join(' → '),
            hint: finding.typeOnly
              ? 'Only types are involved, so this is harmless at runtime.'
              : 'Move the shared code into a third file that both can import.',
            files,
          }
        }),
      }
    },
  },
  {
    id: 'todo-report',
    title: 'TODO comments',
    description: 'TODO, FIXME and HACK notes left in comments.',
    group: 'code',
    options: [
      {
        key: 'tags',
        label: 'Tags',
        type: 'list',
        default: 'TODO\nFIXME\nHACK',
        help: 'The words to look for, one per line.',
      },
      ...COMMON_OPTIONS,
    ],
    run: ({ cwd, list }) => {
      const tags = list('tags')
      const report = runTodoReport({
        paths: ['.'],
        cwd,
        ...(tags.length ? { tags } : {}),
        ignoreGlobs: list('ignore'),
      })
      return {
        summary: `${plural(report.findings.length, 'note')} in ${plural(report.filesScanned, 'file')}`,
        filesScanned: report.filesScanned,
        exitCode: 0,
        findings: report.findings.map((finding) => ({
          file: relativeTo(cwd, finding.file),
          line: finding.line,
          column: finding.column,
          severity: finding.tag === 'FIXME' ? 'warning' : 'info',
          code: finding.tag,
          message: finding.text.trim() || finding.tag,
        })),
      }
    },
  },
  {
    id: 'stale-ts-ignore',
    title: 'Stale @ts-ignore',
    description:
      '@ts-ignore comments that no longer hide an error. This one type-checks the project, so it takes a while.',
    group: 'code',
    slow: true,
    options: COMMON_OPTIONS,
    run: ({ cwd, list }) => {
      const report = runStaleTsIgnore({ dir: cwd, ignoreGlobs: list('ignore') })
      return {
        summary: report.error
          ? 'Could not type-check the project'
          : `${plural(report.findings.length, 'stale directive')} among ${plural(report.directivesChecked, 'directive')}`,
        exitCode: report.exitCode,
        ...(report.error ? { error: report.error } : {}),
        findings: report.findings.map((finding) => ({
          file: relativeTo(cwd, finding.file),
          line: finding.line,
          severity: 'warning',
          code: 'stale',
          message: 'This @ts-ignore hides nothing: the error it was added for is gone.',
          hint: 'Delete the comment.',
        })),
      }
    },
  },
  {
    id: 'exports-doctor',
    title: 'package.json exports',
    description:
      'main, module, types, bin and exports entries that point to files that are missing or have the wrong case.',
    group: 'dependencies',
    options: [],
    run: ({ cwd }) => {
      const report = runExportsDoctor({ dir: cwd })
      const messages: Record<string, string> = {
        missing: 'points to a file that does not exist.',
        'case-mismatch': 'differs in letter case from the file on disk.',
        'missing-shebang': 'is a bin file without a #! line at the top.',
        'types-missing': 'has no types declared for this entry.',
      }
      return {
        summary: report.error
          ? 'Could not read package.json'
          : `${plural(report.findings.length, 'problem')}${report.packageName ? ` in ${report.packageName}` : ''}`,
        exitCode: report.exitCode,
        ...(report.error ? { error: report.error } : {}),
        findings: report.findings.map((finding) => ({
          file: 'package.json',
          severity: finding.kind === 'types-missing' ? 'warning' : 'error',
          code: finding.kind,
          message: `\`${finding.location}\` (${finding.path}) ${messages[finding.kind] ?? 'has a problem.'}`,
          ...(finding.realPath ? { hint: `On disk it is spelled ${finding.realPath}.` } : {}),
        })),
      }
    },
  },
  {
    id: 'readme-check',
    title: 'README code samples',
    description: 'TypeScript code blocks in the README that no longer type-check.',
    group: 'docs',
    options: [
      {
        key: 'files',
        label: 'Markdown files',
        type: 'list',
        default: 'README.md',
        help: 'Files to check, one per line, relative to the project.',
      },
    ],
    run: ({ cwd, list }) => {
      const files = list('files')
      const report = runReadmeCheck({ dir: cwd, ...(files.length ? { files } : {}) })
      const blocks = report.fileResults.reduce((sum, file) => sum + file.blocksChecked, 0)
      return {
        summary: report.error
          ? 'Could not check the README'
          : `${plural(report.findings.length, 'problem')} in ${plural(blocks, 'code block')}`,
        exitCode: report.exitCode,
        ...(report.error ? { error: report.error } : {}),
        findings: report.findings.map((finding) => ({
          file: relativeTo(cwd, finding.file),
          line: finding.line,
          column: finding.column,
          severity: 'error',
          code: finding.lang,
          message: finding.message,
        })),
      }
    },
  },
  {
    id: 'scripts-check',
    title: 'npm scripts in the docs',
    description: 'Docs and CI mention scripts that do not exist, or scripts nobody documents.',
    group: 'docs',
    options: [
      {
        key: 'files',
        label: 'Docs to read',
        type: 'list',
        default: 'README.md',
        help: 'Files to check, one per line, relative to the project.',
      },
    ],
    run: ({ cwd, list }) => {
      const files = list('files')
      const report = runScriptsCheck({ dir: cwd, ...(files.length ? { files } : {}) })
      return {
        summary: report.error
          ? 'Could not read package.json'
          : `${plural(report.findings.length, 'mismatch', 'mismatches')} across ${plural(report.sourcesScanned.length, 'file')}`,
        exitCode: report.exitCode,
        ...(report.error ? { error: report.error } : {}),
        findings: report.findings.map((finding) => ({
          file: relativeTo(cwd, finding.file),
          line: finding.line,
          severity: finding.kind === 'missing' ? 'error' : 'info',
          code: finding.kind,
          message:
            finding.kind === 'missing'
              ? `The docs mention \`${finding.name}\`, but package.json has no such script.`
              : `The script \`${finding.name}\` is not mentioned anywhere in the docs or CI.`,
        })),
      }
    },
  },
]

function inputFrom(cwd: string, options: Record<string, unknown>): RunInput {
  return {
    cwd,
    flag: (key) => options[key] === true,
    list: (key) => {
      const value = options[key]
      const text = typeof value === 'string' ? value : ''
      return text
        .split(/\r?\n|,/)
        .map((part) => part.trim())
        .filter(Boolean)
    },
  }
}

function projectOf(ctx: RouteContext, value: unknown): string {
  const dir = resolveUserPath(typeof value === 'string' ? value : null, ctx.server.cwd)
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new HttpError(404, `${dir} is not a folder`)
  }
  return dir
}

function findCheck(id: string | undefined): CheckDef {
  const found = CHECKS.find((check) => check.id === id)
  if (!found) throw new HttpError(404, `no check named "${id}"`)
  return found
}

async function startCheck(ctx: RouteContext): Promise<void> {
  const check = findCheck(ctx.params.id)
  const body = asObject(await ctx.readBody())
  const cwd = projectOf(ctx, body.project)
  const options = body.options === undefined ? {} : asObject(body.options, 'options')
  const id = startJob(async () => {
    const started = Date.now()
    const outcome = check.run(inputFrom(cwd, options))
    return { ...outcome, project: cwd, check: check.id, tookMs: Date.now() - started }
  })
  sendJson(ctx.res, 202, { jobId: id })
}

function defaultsOf(check: CheckDef): Record<string, unknown> {
  return Object.fromEntries(check.options.map((option) => [option.key, option.default]))
}

async function startAll(ctx: RouteContext): Promise<void> {
  const body = asObject(await ctx.readBody())
  const cwd = projectOf(ctx, body.project)
  const includeSlow = body.includeSlow === true
  const chosen = CHECKS.filter((check) => includeSlow || !check.slow)
  const skipped = CHECKS.filter((check) => !chosen.includes(check)).map((check) => check.id)
  const id = startJob(async (progress) => {
    const started = Date.now()
    const outcomes: Record<string, unknown> = {}
    for (const [index, check] of chosen.entries()) {
      progress({ done: index, total: chosen.length, current: check.title })
      await new Promise<void>((resolveTick) => setImmediate(resolveTick))
      const begun = Date.now()
      let outcome: CheckOutcome
      try {
        outcome = check.run(inputFrom(cwd, defaultsOf(check)))
      } catch (error) {
        outcome = {
          summary: 'The check could not run',
          findings: [],
          error: error instanceof Error ? error.message : String(error),
          exitCode: 1,
        }
      }
      outcomes[check.id] = { ...outcome, project: cwd, check: check.id, tookMs: Date.now() - begun }
    }
    progress({ done: chosen.length, total: chosen.length, current: '' })
    return { project: cwd, outcomes, skipped, tookMs: Date.now() - started }
  })
  sendJson(ctx.res, 202, { jobId: id })
}

const SOURCE_LANGS: Record<string, string> = {
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.mts': 'ts',
  '.cts': 'ts',
  '.js': 'js',
  '.jsx': 'jsx',
  '.mjs': 'js',
  '.cjs': 'js',
  '.vue': 'vue',
  '.json': 'json',
  '.css': 'css',
  '.scss': 'scss',
  '.html': 'html',
  '.md': 'md',
  '.yml': 'yaml',
  '.yaml': 'yaml',
}
const MAX_SOURCE_BYTES = 1024 * 1024

function readSource(ctx: RouteContext): void {
  const project = projectOf(ctx, ctx.url.searchParams.get('project'))
  const raw = ctx.url.searchParams.get('path')
  if (!raw) throw new HttpError(400, 'give a file path')
  const abs = resolve(project, raw)
  const real = existsSync(abs) ? realpathSync(abs) : abs
  const root = realpathSync(project)
  if (real !== root && !real.startsWith(root + sep)) {
    throw new HttpError(403, 'the file is outside the project folder')
  }
  const lang = SOURCE_LANGS[extname(abs).toLowerCase()] ?? 'text'
  const stat = statSync(abs, { throwIfNoEntry: false })
  if (!stat?.isFile()) throw new HttpError(404, 'no such file')
  if (stat.size > MAX_SOURCE_BYTES) throw new HttpError(413, 'this file is too large to show')
  const text = readFileSync(abs, 'utf8')
  sendJson(ctx.res, 200, {
    path: relative(project, abs).split(sep).join('/'),
    abs,
    lang,
    lines: text.split(/\r\n|\r|\n/).length,
    text,
  })
}

const routes: Route[] = [
  {
    method: 'GET',
    path: '/api/checks',
    handler: ({ res }) => {
      sendJson(
        res,
        200,
        CHECKS.map(({ id, title, description, group, options, slow }) => ({
          id,
          title,
          description,
          group,
          options,
          slow: slow === true,
        })),
      )
    },
  },
  { method: 'POST', path: '/api/checks/all/run', handler: startAll },
  { method: 'POST', path: '/api/checks/:id/run', handler: startCheck },
  { method: 'GET', path: '/api/source', handler: readSource },
]

export const checksModule: UiModule = {
  id: 'checks',
  title: 'Code checks',
  description: 'Find dead code, unused dependencies and other problems in a project.',
  status: 'available',
  routes,
}
