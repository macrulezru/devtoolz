import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startUiServer, type UiServerHandle } from '../commands/ui/server.js'

let root: string
let server: UiServerHandle
let base: string
let cookie: string

async function call(path: string, init: RequestInit = {}, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { cookie, ...(init.headers as Record<string, string> | undefined), ...headers },
  })
}

async function post(path: string, body: unknown) {
  return call(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function waitForJob(jobId: string): Promise<{ type: string; data: Record<string, unknown> }> {
  const response = await call(`/api/jobs/${jobId}/events`)
  const text = await response.text()
  const events = text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const type = /^event: (.*)$/m.exec(block)?.[1] ?? ''
      const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? '{}') as Record<string, unknown>
      return { type, data }
    })
  return events[events.length - 1] as { type: string; data: Record<string, unknown> }
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'ui-server-'))
  mkdirSync(join(root, 'photos', 'sub'), { recursive: true })
  mkdirSync(join(root, 'static'), { recursive: true })
  writeFileSync(join(root, 'static', 'index.html'), '<!doctype html><title>x</title>')
  writeFileSync(join(root, 'photos', 'notes.txt'), 'x')
  server = await startUiServer({
    cwd: root,
    token: 'secret',
    staticDir: join(root, 'static'),
    version: '9.9.9',
  })
  base = `http://127.0.0.1:${server.port}`
  cookie = `devtoolz-ui-${server.port}=secret`
})

afterEach(async () => {
  await server.close()
  rmSync(root, { recursive: true, force: true })
})

describe('devtoolz ui server', { timeout: 60_000 }, () => {
  it('listens on this machine only and prints an address with the token', () => {
    expect(server.host).toBe('127.0.0.1')
    expect(server.url).toBe(`${base}/?token=secret`)
  })

  it('sets the cookie for the right token and refuses a wrong one', async () => {
    const good = await fetch(`${base}/?token=secret`, { redirect: 'manual' })
    expect(good.status).toBe(302)
    expect(good.headers.get('set-cookie')).toContain(`devtoolz-ui-${server.port}=secret`)
    expect(good.headers.get('set-cookie')).toContain('HttpOnly')
    expect(good.headers.get('set-cookie')).toContain('SameSite=Strict')
    const bad = await fetch(`${base}/?token=nope`, { redirect: 'manual' })
    expect(bad.status).toBe(403)
  })

  it('needs the cookie for the pages and for every endpoint', async () => {
    expect((await fetch(`${base}/`)).status).toBe(401)
    expect((await fetch(`${base}/api/status`)).status).toBe(401)
    const page = await call('/')
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<title>x</title>')
  })

  it('rejects a foreign Host and a foreign Origin', async () => {
    const host = await new Promise<number>((resolveStatus) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port: server.port,
          path: '/api/status',
          headers: { cookie, Host: 'evil.example' },
        },
        (response) => {
          response.resume()
          resolveStatus(response.statusCode ?? 0)
        },
      )
      request.end()
    })
    expect(host).toBe(403)
    const origin = await call('/api/status', {}, { Origin: 'http://evil.example' })
    expect(origin.status).toBe(403)
  })

  it('reports the version, the folder and the modules', async () => {
    const status = (await (await call('/api/status')).json()) as {
      version: string
      cwd: string
      modules: { id: string; status: string }[]
    }
    expect(status.version).toBe('9.9.9')
    expect(status.cwd).toBe(root)
    expect(status.modules).toEqual([
      expect.objectContaining({ id: 'checks', status: 'available' }),
      expect.objectContaining({ id: 'cleanup', status: 'available' }),
    ])
  })

  it('lists folders only', async () => {
    const listing = (await (
      await call(`/api/fs/list?path=${encodeURIComponent(join(root, 'photos'))}`)
    ).json()) as { entries: { name: string; kind: string }[]; parent: string }
    expect(listing.entries.map((entry) => `${entry.kind}:${entry.name}`)).toEqual(['dir:sub'])
    expect(listing.parent).toBe(root)
    expect((await call('/api/fs/list?path=nowhere')).status).toBe(404)
  })

  it('says how to build the UI when the static files are missing', async () => {
    const lonely = await startUiServer({ cwd: root, token: 't', staticDir: join(root, 'missing') })
    try {
      const response = await fetch(`http://127.0.0.1:${lonely.port}/`, {
        headers: { cookie: `devtoolz-ui-${lonely.port}=t` },
      })
      expect(response.status).toBe(503)
      expect(await response.text()).toContain('npm run build')
    } finally {
      await lonely.close()
    }
  })

  it('does not serve files outside the static folder', async () => {
    const response = await call('/..%2f..%2fstatic%2findex.html')
    expect([200, 404]).toContain(response.status)
    const escape = await call('/../package.json')
    expect(await escape.text()).not.toContain('"name"')
  })
})

describe('devtoolz ui code checks', { timeout: 120_000 }, () => {
  let project: string

  beforeEach(() => {
    project = join(root, 'proj')
    mkdirSync(join(project, 'src'), { recursive: true })
    writeFileSync(
      join(project, 'package.json'),
      JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { lodash: '^4.0.0' } }),
    )
    writeFileSync(
      join(project, 'src', 'main.ts'),
      "import { used } from './lib'\nused()\ntry {\n  used()\n} catch (error) {}\n",
    )
    writeFileSync(
      join(project, 'src', 'lib.ts'),
      'export function used() {}\nexport function neverUsed() {}\n',
    )
    writeFileSync(
      join(project, 'src', 'gone.test.ts'),
      "import { it } from 'vitest'\nit('x', () => {})\n",
    )
  })

  const runCheck = async (id: string, options: Record<string, unknown> = {}) => {
    const started = await post(`/api/checks/${id}/run`, { project, options })
    expect(started.status).toBe(202)
    const { jobId } = (await started.json()) as { jobId: string }
    const last = await waitForJob(jobId)
    expect(last.type).toBe('done')
    return last.data as unknown as {
      summary: string
      findings: {
        file?: string
        line?: number
        severity: string
        code: string
        message: string
        hint?: string
      }[]
      project: string
      check: string
    }
  }

  it('lists the available checks with their options', async () => {
    const checks = (await (await call('/api/checks')).json()) as {
      id: string
      options: { key: string }[]
    }[]
    expect(checks.map((check) => check.id).slice(0, 4)).toEqual([
      'dead-exports',
      'unused-deps',
      'empty-catch',
      'orphan-tests',
    ])
    expect(checks[0]?.options.map((option) => option.key)).toContain('strict')
  })

  it('finds dead exports with file and line', async () => {
    const outcome = await runCheck('dead-exports')
    const dead = outcome.findings.find((finding) => finding.message.includes('neverUsed'))
    expect(dead).toMatchObject({ file: 'src/lib.ts', line: 2, severity: 'warning' })
    expect(outcome.project).toBe(project)
    expect(outcome.summary).toContain('unused export')
  })

  it('finds unused dependencies', async () => {
    const outcome = await runCheck('unused-deps')
    expect(outcome.findings).toEqual([
      expect.objectContaining({ file: 'package.json', code: 'unused' }),
    ])
    expect(outcome.findings[0]?.message).toContain('lodash')
    const ignored = await runCheck('unused-deps', { ignorePackages: 'lodash' })
    expect(ignored.findings).toEqual([])
  })

  it('finds empty catch blocks and orphan tests', async () => {
    const empty = await runCheck('empty-catch')
    expect(empty.findings[0]).toMatchObject({
      file: 'src/main.ts',
      line: 5,
      code: 'empty',
      severity: 'error',
    })
    const orphan = await runCheck('orphan-tests')
    expect(orphan.findings[0]).toMatchObject({ file: 'src/gone.test.ts', code: 'orphan' })
  })

  it('honors ignore patterns', async () => {
    const outcome = await runCheck('empty-catch', { ignore: 'src/main.ts' })
    expect(outcome.findings).toEqual([])
  })

  it('refuses an unknown check and a missing project', async () => {
    expect((await post('/api/checks/nope/run', { project })).status).toBe(404)
    expect(
      (await post('/api/checks/empty-catch/run', { project: join(root, 'missing') })).status,
    ).toBe(404)
  })

  it('shows source files from the project, and nothing outside it', async () => {
    const shown = (await (
      await call(`/api/source?project=${encodeURIComponent(project)}&path=src/lib.ts`)
    ).json()) as { path: string; lang: string; lines: number; text: string }
    expect(shown).toMatchObject({ path: 'src/lib.ts', lang: 'ts', lines: 3 })
    expect(shown.text).toContain('neverUsed')
    const outside = await call(
      `/api/source?project=${encodeURIComponent(project)}&path=../photos/a.png`,
    )
    expect(outside.status).toBe(403)
    expect(
      (await call(`/api/source?project=${encodeURIComponent(project)}&path=src/none.ts`)).status,
    ).toBe(404)
  })
})

describe('devtoolz ui all the checks', { timeout: 180_000 }, () => {
  let project: string

  beforeEach(() => {
    project = join(root, 'proj2')
    mkdirSync(join(project, 'src'), { recursive: true })
    writeFileSync(
      join(project, 'package.json'),
      JSON.stringify({
        name: 'demo2',
        version: '1.0.0',
        main: 'dist/missing.js',
        scripts: { test: 'vitest', lint: 'eslint .' },
      }),
    )
    writeFileSync(
      join(project, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', noEmit: true },
      }),
    )
    writeFileSync(join(project, 'src', 'Lib.ts'), 'export const a = 1\n')
    writeFileSync(
      join(project, 'src', 'a.ts'),
      "import { b } from './b'\nimport { a } from './lib'\n// TODO: tidy this up\n// FIXME: broken on Safari\nexport const x = b + a\n",
    )
    writeFileSync(join(project, 'src', 'b.ts'), "import { x } from './a'\nexport const b = x\n")
    writeFileSync(
      join(project, 'src', 's.ts'),
      '// @ts-ignore\nconst fine: number = 1\nexport { fine }\n',
    )
    writeFileSync(
      join(project, 'README.md'),
      '# Demo\n\nRun `npm run build` first.\n\n```ts\nconst n: number = "text"\n```\n',
    )
  })

  const runCheck = async (id: string, options: Record<string, unknown> = {}) => {
    const started = await post(`/api/checks/${id}/run`, { project, options })
    const { jobId } = (await started.json()) as { jobId: string }
    const last = await waitForJob(jobId)
    expect(last.type).toBe('done')
    return last.data as unknown as {
      summary: string
      error?: string
      findings: {
        file?: string
        line?: number
        severity: string
        code: string
        message: string
        files?: string[]
      }[]
    }
  }

  it('lists every check, marking the slow one', async () => {
    const checks = (await (await call('/api/checks')).json()) as {
      id: string
      group: string
      slow: boolean
    }[]
    expect(checks.map((check) => check.id)).toEqual([
      'dead-exports',
      'unused-deps',
      'empty-catch',
      'orphan-tests',
      'case-check',
      'circular-imports',
      'todo-report',
      'stale-ts-ignore',
      'exports-doctor',
      'readme-check',
      'scripts-check',
    ])
    expect(checks.find((check) => check.id === 'stale-ts-ignore')?.slow).toBe(true)
    expect(checks.filter((check) => check.slow)).toHaveLength(1)
    expect(new Set(checks.map((check) => check.group))).toEqual(
      new Set(['code', 'dependencies', 'docs']),
    )
  })

  it('finds imports with the wrong letter case', async () => {
    const outcome = await runCheck('case-check')
    expect(outcome.findings[0]).toMatchObject({
      file: 'src/a.ts',
      line: 2,
      severity: 'error',
      code: 'case',
    })
    expect(outcome.findings[0]?.message).toContain('./Lib')
  })

  it('finds import cycles and lists the files in them', async () => {
    const outcome = await runCheck('circular-imports')
    expect(outcome.findings).toHaveLength(1)
    expect(outcome.findings[0]?.files?.sort()).toEqual(['src/a.ts', 'src/b.ts'])
    expect(outcome.findings[0]?.message).toContain('→')
  })

  it('finds TODO notes and keeps the tags it was given', async () => {
    const outcome = await runCheck('todo-report')
    expect(outcome.findings.map((finding) => finding.code).sort()).toEqual(['FIXME', 'TODO'])
    expect(outcome.findings.find((finding) => finding.code === 'TODO')).toMatchObject({
      file: 'src/a.ts',
      line: 3,
      severity: 'info',
    })
    const only = await runCheck('todo-report', { tags: 'FIXME' })
    expect(only.findings.map((finding) => finding.code)).toEqual(['FIXME'])
  })

  it('finds a stale @ts-ignore', async () => {
    const outcome = await runCheck('stale-ts-ignore')
    expect(outcome.findings[0]).toMatchObject({ file: 'src/s.ts', line: 1, code: 'stale' })
  })

  it('checks package.json entries, README samples and documented scripts', async () => {
    const exportsOutcome = await runCheck('exports-doctor')
    expect(exportsOutcome.findings[0]).toMatchObject({
      file: 'package.json',
      code: 'missing',
      severity: 'error',
    })
    const readme = await runCheck('readme-check')
    expect(readme.findings[0]).toMatchObject({ file: 'README.md', line: 6, severity: 'error' })
    const scripts = await runCheck('scripts-check')
    expect(scripts.findings.find((finding) => finding.code === 'missing')?.message).toContain(
      'build',
    )
    expect(scripts.findings.some((finding) => finding.code === 'undocumented')).toBe(true)
  })

  it('runs every check but the slow one for the overview', async () => {
    const started = await post('/api/checks/all/run', { project })
    expect(started.status).toBe(202)
    const { jobId } = (await started.json()) as { jobId: string }
    const last = await waitForJob(jobId)
    expect(last.type).toBe('done')
    const data = last.data as unknown as {
      outcomes: Record<string, { findings: unknown[]; summary: string; project: string }>
      skipped: string[]
    }
    expect(data.skipped).toEqual(['stale-ts-ignore'])
    expect(Object.keys(data.outcomes)).toHaveLength(10)
    expect(data.outcomes['case-check']?.findings.length).toBeGreaterThan(0)
    expect(data.outcomes['circular-imports']?.project).toBe(project)

    const withSlow = await post('/api/checks/all/run', { project, includeSlow: true })
    const second = await waitForJob(((await withSlow.json()) as { jobId: string }).jobId)
    const all = second.data as unknown as { outcomes: Record<string, unknown>; skipped: string[] }
    expect(all.skipped).toEqual([])
    expect(Object.keys(all.outcomes)).toHaveLength(11)
  })
})

describe('devtoolz ui code cleanup', { timeout: 120_000 }, () => {
  let project: string
  const original = {
    main: '// entry point\nconst a = 1 // the answer\nconsole.log(a)\nexport { a }\n',
    other: '/* helper */\nexport const b = 2\nconsole.debug(b)\n',
  }

  beforeEach(() => {
    project = join(root, 'cleanup-proj')
    mkdirSync(join(project, 'src'), { recursive: true })
    writeFileSync(join(project, 'src', 'main.ts'), original.main)
    writeFileSync(join(project, 'src', 'other.ts'), original.other)
    writeFileSync(join(project, 'package.json'), '{ "name": "x" }\n')
  })

  type ScanFile = { file: string; count: number; diff?: string; hash: string }

  const scan = async (tool: string, options: Record<string, unknown> = {}) => {
    const started = await post(`/api/cleanup/${tool}/scan`, { project, options })
    expect(started.status).toBe(202)
    const { jobId } = (await started.json()) as { jobId: string }
    const last = await waitForJob(jobId)
    expect(last.type).toBe('done')
    return last.data as unknown as {
      files: ScanFile[]
      total: number
      filesScanned: number
      skipped: unknown[]
    }
  }

  const apply = (tool: string, files: { file: string; hash: string }[], options = {}) =>
    post(`/api/cleanup/${tool}/apply`, { project, options, files })

  const read = (name: string) => readFileSync(join(project, 'src', name), 'utf8')

  it('lists the tools with their options', async () => {
    const tools = (await (await call('/api/cleanup/tools')).json()) as {
      id: string
      options: { key: string }[]
    }[]
    expect(tools.map((tool) => tool.id)).toEqual(['strip-comments', 'console-strip'])
    expect(tools[0]?.options.map((option) => option.key)).toContain('keepJsdoc')
  })

  it('previews comment removal with a diff and changes nothing', async () => {
    const result = await scan('strip-comments')
    expect(result.files.map((file) => file.file).sort()).toEqual(['src/main.ts', 'src/other.ts'])
    expect(result.total).toBe(3)
    const main = result.files.find((file) => file.file === 'src/main.ts')
    expect(main?.count).toBe(2)
    expect(main?.diff).toContain('-// entry point')
    expect(main?.hash).toHaveLength(40)
    expect(read('main.ts')).toBe(original.main)
  })

  it('removes console calls and reports what it would not touch', async () => {
    writeFileSync(
      join(project, 'src', 'tricky.ts'),
      'const v = (console.log(1), 2)\nexport { v }\n',
    )
    const result = await scan('console-strip')
    expect(result.files.map((file) => file.file).sort()).toEqual(['src/main.ts', 'src/other.ts'])
    expect(result.skipped).toHaveLength(1)
    const onlyLog = await scan('console-strip', { methods: 'log' })
    expect(onlyLog.files.map((file) => file.file)).toEqual(['src/main.ts'])
  })

  it('writes only the files that were chosen, and keeps a backup', async () => {
    const result = await scan('strip-comments')
    const main = result.files.find((file) => file.file === 'src/main.ts') as ScanFile
    const response = await apply('strip-comments', [{ file: main.file, hash: main.hash }])
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      results: { file: string; status: string; count?: number }[]
      backupDir: string
    }
    expect(body.results).toEqual([{ file: 'src/main.ts', status: 'applied', count: 2 }])
    expect(read('main.ts')).not.toContain('//')
    expect(read('other.ts')).toBe(original.other)
    expect(existsSync(join(body.backupDir, 'journal.json'))).toBe(true)
    expect(existsSync(join(body.backupDir, 'meta.json'))).toBe(true)
  })

  it('refuses a file that changed after the scan', async () => {
    const result = await scan('strip-comments')
    const main = result.files.find((file) => file.file === 'src/main.ts') as ScanFile
    writeFileSync(join(project, 'src', 'main.ts'), `${original.main}// added later\n`)
    const response = await apply('strip-comments', [{ file: main.file, hash: main.hash }])
    const body = (await response.json()) as { results: { status: string }[]; backupDir?: string }
    expect(body.results[0]?.status).toBe('changed')
    expect(body.backupDir).toBeUndefined()
    expect(read('main.ts')).toContain('added later')
  })

  it('refuses paths outside the project and files that are not source code', async () => {
    const outside = await apply('strip-comments', [{ file: '../photos/a.png', hash: 'x' }])
    expect(((await outside.json()) as { results: { status: string }[] }).results[0]?.status).toBe(
      'refused',
    )
    const json = await apply('strip-comments', [{ file: 'package.json', hash: 'x' }])
    expect(((await json.json()) as { results: { status: string }[] }).results[0]?.status).toBe(
      'refused',
    )
    expect((await apply('strip-comments', [])).status).toBe(400)
    expect((await post('/api/cleanup/nope/scan', { project })).status).toBe(404)
  })

  it('undoes a cleanup from its backup, and lists it in the history', async () => {
    const result = await scan('strip-comments')
    const files = result.files.map((file) => ({ file: file.file, hash: file.hash }))
    const applied = (await (await apply('strip-comments', files)).json()) as { backupDir: string }
    expect(read('other.ts')).not.toContain('/*')

    const history = (await (
      await call(`/api/cleanup/history?project=${encodeURIComponent(project)}`)
    ).json()) as { backups: { dir: string; tool: string; files: number }[] }
    expect(history.backups[0]).toMatchObject({
      dir: applied.backupDir,
      tool: 'strip-comments',
      files: 2,
    })

    const restored = (await (
      await post('/api/cleanup/undo', { project, dir: applied.backupDir })
    ).json()) as { counts: Record<string, number> }
    expect(restored.counts.restored).toBe(2)
    expect(read('main.ts')).toBe(original.main)
    expect(read('other.ts')).toBe(original.other)

    const elsewhere = await post('/api/cleanup/undo', { project, dir: join(root, 'photos') })
    expect(elsewhere.status).toBe(403)
  })
})
