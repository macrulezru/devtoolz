import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, parse, resolve } from 'node:path'
import { HttpError, sendJson, type Route } from './http.js'

const MAX_ENTRIES = 5000

function roots(): string[] {
  if (process.platform !== 'win32') return ['/']
  const found: string[] = []
  for (let code = 65; code <= 90; code++) {
    const drive = `${String.fromCharCode(code)}:\\`
    if (existsSync(drive)) found.push(drive)
  }
  return found
}

export function resolveUserPath(raw: string | null, fallback: string): string {
  if (raw === null || raw.trim() === '') return fallback
  const path = raw.trim()
  return isAbsolute(path) ? resolve(path) : resolve(fallback, path)
}

export const fsRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/fs/list',
    handler: ({ res, url, server }) => {
      const path = resolveUserPath(url.searchParams.get('path'), server.cwd)
      const showHidden = url.searchParams.get('hidden') === '1'
      const stat = statSync(path, { throwIfNoEntry: false })
      if (!stat?.isDirectory()) throw new HttpError(404, `${path} is not a folder`)
      let names: import('node:fs').Dirent[]
      try {
        names = readdirSync(path, { withFileTypes: true })
      } catch (error) {
        throw new HttpError(403, error instanceof Error ? error.message : String(error))
      }
      const folders: { name: string; kind: 'dir' }[] = []
      for (const entry of names) {
        if (!showHidden && entry.name.startsWith('.')) continue
        if (entry.isDirectory()) folders.push({ name: entry.name, kind: 'dir' })
      }
      folders.sort((a, b) => a.name.localeCompare(b.name))
      const parent = dirname(path)
      sendJson(res, 200, {
        path,
        parent: parent === path ? null : parent,
        home: homedir(),
        cwd: server.cwd,
        root: parse(path).root,
        roots: roots(),
        entries: folders.slice(0, MAX_ENTRIES),
        truncated: folders.length > MAX_ENTRIES,
      })
    },
  },
]
