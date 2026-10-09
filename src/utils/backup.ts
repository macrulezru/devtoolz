import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BackupUsageError } from './backup-error.js'

export const JOURNAL_FILE = 'journal.json'

export interface JournalEntry {
  path: string
  backup: string
  bytesBefore: number
  bytesAfter: number
  hashBefore: string
  hashAfter: string
}

export interface Journal {
  version: 1
  createdAt: string
  cwd: string
  entries: JournalEntry[]
}

export function copyIntoBackup(source: string, backup: string): void {
  mkdirSync(dirname(backup), { recursive: true })
  copyFileSync(source, backup)
}

export function newJournal(cwd: string, now: Date): Journal {
  return { version: 1, createdAt: now.toISOString(), cwd, entries: [] }
}

export function saveJournal(backupDir: string, journal: Journal): void {
  mkdirSync(backupDir, { recursive: true })
  writeFileSync(join(backupDir, JOURNAL_FILE), `${JSON.stringify(journal, null, 2)}\n`)
}

export function loadJournal(backupDir: string): Journal {
  const path = join(backupDir, JOURNAL_FILE)
  if (!existsSync(path)) {
    throw new BackupUsageError(`${backupDir} has no ${JOURNAL_FILE} — pass the dated backup folder`)
  }
  let parsed: Journal
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as Journal
  } catch (error) {
    throw new BackupUsageError(
      `${path}: not valid JSON — ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new BackupUsageError(`${path}: not a backup journal`)
  }
  return parsed
}
