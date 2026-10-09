import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, relative, resolve, sep } from 'node:path'
import {
  copyIntoBackup,
  newJournal,
  saveJournal,
  type JournalEntry,
} from '../../../utils/backup.js'
import { runRestore } from '../../../utils/restore.js'
import { runConsoleStrip } from '../../console-strip/run.js'
import { runStripComments } from '../../strip-comments/run.js'
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
import type { OptionDef } from './checks.js'

interface Change {
  file: string
  count: number
  diff?: string
}

interface ScanOutput {
  filesScanned: number
  changes: Change[]
  skipped: { file: string; line: number; column: number; snippet: string; reason: string }[]
}

interface ToolDef {
  id: string
  title: string
  description: string
  verb: string
  options: OptionDef[]
  run: (
    cwd: string,
    paths: string[],
    options: Record<string, unknown>,
    write: boolean,
  ) => ScanOutput
}

const IGNORE: OptionDef = {
  key: 'ignore',
  label: 'Ignore',
  type: 'list',
  default: '',
  help: 'Extra patterns to skip, one per line (gitignore syntax).',
}

function list(options: Record<string, unknown>, key: string): string[] {
  const value = options[key]
  return (typeof value === 'string' ? value : '')
    .split(/\r?\n|,/)
    .map((part) => part.trim())
    .filter(Boolean)
}

const TOOLS: ToolDef[] = [
  {
    id: 'strip-comments',
    title: 'Remove comments',
    description: 'Delete // and /* */ comments from source files, without touching code.',
    verb: 'comment',
    options: [
      {
        key: 'keepJsdoc',
        label: 'Keep JSDoc on exports',
        type: 'boolean',
        default: false,
        help: 'Leave the /** */ comment right above an exported declaration.',
      },
      IGNORE,
    ],
    run: (cwd, paths, options, write) => {
      const report = runStripComments({
        paths,
        cwd,
        keepJsdoc: options.keepJsdoc === true,
        ignoreGlobs: list(options, 'ignore'),
        diff: true,
        ...(write ? { yes: true } : {}),
      })
      return { filesScanned: report.filesScanned, changes: report.changes, skipped: [] }
    },
  },
  {
    id: 'console-strip',
    title: 'Remove console calls',
    description: 'Delete console.log, console.debug and debugger statements.',
    verb: 'call',
    options: [
      {
        key: 'methods',
        label: 'console methods',
        type: 'list',
        default: 'log\ndebug',
        help: 'Which console.<method> calls to remove, one per line.',
      },
      {
        key: 'debugger',
        label: 'Also remove debugger statements',
        type: 'boolean',
        default: true,
        help: 'Delete bare `debugger;` lines too.',
      },
      IGNORE,
    ],
    run: (cwd, paths, options, write) => {
      const methods = list(options, 'methods')
      const report = runConsoleStrip({
        paths,
        cwd,
        ...(methods.length ? { methods } : {}),
        debugger: options.debugger !== false,
        ignoreGlobs: list(options, 'ignore'),
        diff: true,
        ...(write ? { yes: true } : {}),
      })
      return {
        filesScanned: report.filesScanned,
        changes: report.changes,
        skipped: report.skipped.map((entry) => ({
          file: entry.file,
          line: entry.line,
          column: entry.column,
          snippet: entry.snippet,
          reason: entry.reason,
        })),
      }
    },
  },
]

const EDITABLE = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.vue'])
const BACKUP_ROOT = join(homedir(), '.devtoolz', 'cleanup-backups')

function sha1(text: string | Buffer): string {
  return createHash('sha1').update(text).digest('hex')
}

function projectOf(ctx: RouteContext, value: unknown): string {
  const dir = resolveUserPath(typeof value === 'string' ? value : null, ctx.server.cwd)
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new HttpError(404, `${dir} is not a folder`)
  }
  return dir
}

function toolOf(id: string | undefined): ToolDef {
  const found = TOOLS.find((tool) => tool.id === id)
  if (!found) throw new HttpError(404, `no tool named "${id}"`)
  return found
}

function backupDirFor(project: string): string {
  return join(BACKUP_ROOT, sha1(realpathSync(project)).slice(0, 12))
}

function inside(project: string, abs: string): boolean {
  const root = realpathSync(project)
  const real = existsSync(abs) ? realpathSync(abs) : abs
  return real.startsWith(root + sep)
}

async function scan(ctx: RouteContext): Promise<void> {
  const tool = toolOf(ctx.params.id)
  const body = asObject(await ctx.readBody())
  const cwd = projectOf(ctx, body.project)
  const options = body.options === undefined ? {} : asObject(body.options, 'options')
  const id = startJob(async () => {
    const started = Date.now()
    const output = tool.run(cwd, ['.'], options, false)
    const files = output.changes.map((change) => {
      const abs = resolve(cwd, change.file)
      return {
        ...change,
        hash: existsSync(abs) ? sha1(readFileSync(abs)) : '',
      }
    })
    return {
      tool: tool.id,
      project: cwd,
      filesScanned: output.filesScanned,
      files,
      skipped: output.skipped,
      total: files.reduce((sum, file) => sum + file.count, 0),
      tookMs: Date.now() - started,
    }
  })
  sendJson(ctx.res, 202, { jobId: id })
}

interface ApplyResult {
  file: string
  status: 'applied' | 'changed' | 'unchanged' | 'refused' | 'error'
  count?: number
  message?: string
}

async function apply(ctx: RouteContext): Promise<void> {
  const tool = toolOf(ctx.params.id)
  const body = asObject(await ctx.readBody())
  const cwd = projectOf(ctx, body.project)
  const options = body.options === undefined ? {} : asObject(body.options, 'options')
  if (!Array.isArray(body.files) || body.files.length === 0) {
    throw new HttpError(400, 'choose at least one file')
  }
  const requested = body.files.map((item) => {
    const entry = asObject(item, 'a file entry')
    if (typeof entry.file !== 'string' || typeof entry.hash !== 'string') {
      throw new HttpError(400, 'each file needs a path and the hash from the scan')
    }
    return { file: entry.file, hash: entry.hash }
  })

  const now = new Date()
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const backupDir = join(backupDirFor(cwd), `${stamp}-${tool.id}`)
  const journal = newJournal(cwd, now)
  const results: ApplyResult[] = []

  for (const { file, hash } of requested) {
    const abs = resolve(cwd, file)
    if (!EDITABLE.has(extname(abs).toLowerCase()) || !inside(cwd, abs)) {
      results.push({ file, status: 'refused', message: 'This file cannot be changed from here.' })
      continue
    }
    if (!existsSync(abs)) {
      results.push({ file, status: 'changed', message: 'The file no longer exists.' })
      continue
    }
    const before = readFileSync(abs)
    if (sha1(before) !== hash) {
      results.push({
        file,
        status: 'changed',
        message: 'The file changed after the scan. Scan again.',
      })
      continue
    }
    try {
      const backup = join(backupDir, relative(cwd, abs))
      copyIntoBackup(abs, backup)
      const output = tool.run(cwd, [abs], options, true)
      const change = output.changes[0]
      if (!change) {
        results.push({ file, status: 'unchanged', message: 'Nothing to remove any more.' })
        continue
      }
      const after = readFileSync(abs)
      const entry: JournalEntry = {
        path: abs,
        backup,
        bytesBefore: before.length,
        bytesAfter: after.length,
        hashBefore: sha1(before),
        hashAfter: sha1(after),
      }
      journal.entries.push(entry)
      results.push({ file, status: 'applied', count: change.count })
    } catch (error) {
      results.push({
        file,
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  let savedTo: string | undefined
  if (journal.entries.length > 0) {
    saveJournal(backupDir, journal)
    mkdirSync(backupDir, { recursive: true })
    writeFileSync(
      join(backupDir, 'meta.json'),
      JSON.stringify({ tool: tool.id, project: cwd, files: journal.entries.length }),
    )
    savedTo = backupDir
  }
  sendJson(ctx.res, 200, { results, backupDir: savedTo })
}

async function undo(ctx: RouteContext): Promise<void> {
  const body = asObject(await ctx.readBody())
  const cwd = projectOf(ctx, body.project)
  if (typeof body.dir !== 'string') throw new HttpError(400, 'give the backup folder')
  const dir = resolve(body.dir)
  if (!dir.startsWith(backupDirFor(cwd) + sep)) {
    throw new HttpError(403, 'this is not a cleanup backup of this project')
  }
  const report = await runRestore({
    dir,
    cwd,
    force: body.force === true,
    assumeYes: true,
    interactive: false,
  })
  sendJson(ctx.res, 200, report)
}

function history(ctx: RouteContext): void {
  const cwd = projectOf(ctx, ctx.url.searchParams.get('project'))
  const root = backupDirFor(cwd)
  const rows: {
    dir: string
    name: string
    tool: string
    files: number
    createdAt: string
  }[] = []
  if (statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(root, entry.name)
      try {
        const journal = JSON.parse(readFileSync(join(dir, 'journal.json'), 'utf8')) as {
          createdAt: string
          entries: unknown[]
        }
        const meta = existsSync(join(dir, 'meta.json'))
          ? (JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as { tool?: string })
          : {}
        rows.push({
          dir,
          name: entry.name,
          tool: meta.tool ?? 'cleanup',
          files: journal.entries.length,
          createdAt: journal.createdAt,
        })
      } catch {
        continue
      }
    }
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  sendJson(ctx.res, 200, { backups: rows.slice(0, 20) })
}

const routes: Route[] = [
  {
    method: 'GET',
    path: '/api/cleanup/tools',
    handler: ({ res }) => {
      sendJson(
        res,
        200,
        TOOLS.map(({ id, title, description, verb, options }) => ({
          id,
          title,
          description,
          verb,
          options,
        })),
      )
    },
  },
  { method: 'POST', path: '/api/cleanup/:id/scan', handler: scan },
  { method: 'POST', path: '/api/cleanup/:id/apply', handler: apply },
  { method: 'POST', path: '/api/cleanup/undo', handler: undo },
  { method: 'GET', path: '/api/cleanup/history', handler: history },
]

export const cleanupModule: UiModule = {
  id: 'cleanup',
  title: 'Code cleanup',
  description: 'Remove comments and console calls, with a diff you approve file by file.',
  status: 'available',
  routes,
}
