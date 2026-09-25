#!/usr/bin/env node
import { Command } from 'commander'
import { resolve } from 'node:path'
import { runStripComments } from './commands/strip-comments/run.js'
import { renderStripCommentsReport } from './commands/strip-comments/report.js'
import { runConsoleStrip } from './commands/console-strip/run.js'
import { renderConsoleStripReport } from './commands/console-strip/report.js'
import { runDeadExports } from './commands/dead-exports/run.js'
import { renderDeadExportsReport } from './commands/dead-exports/report.js'
import { runCaseCheck } from './commands/case-check/run.js'
import { renderCaseCheckReport } from './commands/case-check/report.js'
import { runExportsDoctor } from './commands/exports-doctor/run.js'
import { renderExportsDoctorReport } from './commands/exports-doctor/report.js'
import { runReadmeCheck } from './commands/readme-check/run.js'
import { renderReadmeCheckReport } from './commands/readme-check/report.js'

interface HelpRow {
  indent: number
  label: string
  desc: string
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (current && candidate.length > width) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

/**
 * Commander's own one-line-per-command "Commands:" list puts a command's
 * own flags inline after its name (`strip-comments [options]`) and leaves
 * their descriptions for a separate `<command> --help` run — fine for a
 * CLI with one or two flags per command, but it means the top-level
 * `--help` never actually shows what any flag does. This builds a
 * two-level list instead (command, then each of its own options indented
 * below it with its own description), used in place of commander's
 * default via `configureHelp({ visibleCommands: () => [] })` +
 * `addHelpText('after')` — same technique as lintsync's/polyrepo-cli's
 * own `formatCommandsHelp`.
 *
 * A flag present on EVERY command, with the exact same `flags` string and
 * description (not just the same name coincidentally meaning something
 * slightly different per command), is pulled out into a "Common options"
 * block instead of being repeated under each one. A flag shared by only
 * SOME commands stays listed under each of those commands directly —
 * tried hoisting those into their own labeled sub-group too, but it's
 * harder to keep in your head which commands a "Common options (a, b)"
 * block actually applies to than to just see the flag where it's used.
 * This only changes how the help text is RENDERED — every flag is still
 * fully declared on its own command for real parsing, so
 * `devtoolz <command> --cwd x` keeps working exactly as before; nothing
 * here is a true commander-level global option.
 */
function formatCommandsHelp(commands: readonly Command[]): string {
  const real = commands.filter((cmd) => cmd.name() !== 'help')

  // Which commands (by name) share the exact same flags+description for
  // a given option, keyed on that pair so two different flags spelled
  // the same but described differently never get merged.
  const owners = new Map<string, { flags: string; desc: string; commandCount: number }>()
  for (const cmd of real) {
    for (const opt of cmd.options) {
      const key = `${opt.flags}\u0000${opt.description}`
      const entry = owners.get(key) ?? { flags: opt.flags, desc: opt.description, commandCount: 0 }
      entry.commandCount++
      owners.set(key, entry)
    }
  }

  const universalRows: HelpRow[] = []
  const hoistedKeys = new Set<string>()

  for (const [key, entry] of owners) {
    if (entry.commandCount !== real.length) continue // not on every command — stays with each one below
    universalRows.push({ indent: 1, label: entry.flags, desc: entry.desc })
    hoistedKeys.add(key)
  }

  const commandGroups: HelpRow[][] = real.map((cmd) => {
    const aliases = cmd.aliases()
    const label = aliases.length > 0 ? `${cmd.name()}, ${aliases.join(', ')}` : cmd.name()
    const ownRows = cmd.options
      .filter((opt) => !hoistedKeys.has(`${opt.flags}\u0000${opt.description}`))
      .map((opt): HelpRow => ({ indent: 1, label: opt.flags, desc: opt.description }))
    return [{ indent: 0, label, desc: cmd.description() }, ...ownRows]
  })

  const allRows = [universalRows, ...commandGroups].flat()
  const labelWidth = Math.max(...allRows.map((r) => r.indent * 4 + r.label.length))
  const totalWidth = (process.stdout.isTTY && process.stdout.columns) || 96
  const descWidth = Math.max(totalWidth - (2 + labelWidth + 2), 30)

  function renderRow(row: HelpRow, lines: string[]): void {
    const fullLabel = ' '.repeat(row.indent * 4) + row.label
    const [firstLine, ...restLines] = wrapText(row.desc, descWidth)
    lines.push(`  ${fullLabel.padEnd(labelWidth)}  ${firstLine ?? ''}`)
    for (const cont of restLines) {
      lines.push(`  ${' '.repeat(labelWidth)}  ${cont}`)
    }
  }

  const lines: string[] = []
  if (universalRows.length > 0) {
    lines.push('Common options (all commands):')
    for (const row of universalRows) renderRow(row, lines)
    lines.push('')
  }

  lines.push('Commands:')
  commandGroups.forEach((group, i) => {
    if (i > 0) lines.push('')
    for (const row of group) renderRow(row, lines)
  })
  return lines.join('\n')
}

const program = new Command()

program
  .name('devtoolz')
  .description('A small toolbox of CLI commands that automate routine dev chores')
  // Hide commander's own one-line-per-command list (see formatCommandsHelp
  // above for why) — the "after" text below replaces it with the
  // two-level version instead of showing both.
  .configureHelp({ visibleCommands: () => [] })
  .addHelpText('after', () => `\n${formatCommandsHelp(program.commands)}`)

program
  .command('strip-comments')
  .description(
    'Remove //, /* */, /** */ and <!-- --> comments from source files, without touching code',
  )
  .argument('[paths...]', 'files/directories to process', [])
  .option('--cwd <path>', 'root paths are resolved against', process.cwd())
  .option(
    '--ext <list>',
    'comma-separated extensions to include',
    '.ts,.tsx,.js,.jsx,.cjs,.mjs,.vue',
  )
  .option(
    '--ignore <glob>',
    'extra ignore pattern (repeatable), on top of the built-in defaults',
    (val, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option('--no-respect-gitignore', "don't also honor the project's .gitignore")
  .option(
    '--keep-jsdoc',
    "don't remove a /** */ comment directly above an exported declaration",
    false,
  )
  .option('--dry-run', 'preview changes without writing anything', false)
  .option('-y, --yes', 'apply the changes (without this, it only previews)', false)
  .option('--diff', 'include a unified diff per changed file', false)
  .option('--json', 'machine-readable output', false)
  .option('--quiet', 'suppress output when there is nothing to report', false)
  .option('--plain', 'disable color/banner/celebration copy, even in a real terminal', false)
  .action(
    (
      paths: string[],
      options: {
        cwd: string
        ext: string
        ignore: string[]
        respectGitignore: boolean
        keepJsdoc: boolean
        dryRun: boolean
        yes: boolean
        diff: boolean
        json: boolean
        quiet: boolean
        plain: boolean
      },
    ) => {
      const report = runStripComments({
        paths,
        cwd: resolve(options.cwd),
        extensions: options.ext.split(',').map((e) => e.trim()),
        ignoreGlobs: options.ignore,
        respectGitignore: options.respectGitignore,
        keepJsdoc: options.keepJsdoc,
        dryRun: options.dryRun,
        yes: options.yes,
        diff: options.diff,
      })

      if (options.json) {
        console.log(JSON.stringify(report, null, 2))
      } else {
        const text = renderStripCommentsReport(report, {
          quiet: options.quiet,
          plain: options.plain,
          dryRun: options.dryRun,
        })
        if (text) console.log(text)
      }

      process.exitCode = report.exitCode
    },
  )

program
  .command('console-strip')
  .description('Remove console.log/console.debug/debugger statements left in by mistake')
  .argument('[paths...]', 'files/directories to process', [])
  .option('--cwd <path>', 'root paths are resolved against', process.cwd())
  .option(
    '--ext <list>',
    'comma-separated extensions to include',
    '.ts,.tsx,.js,.jsx,.cjs,.mjs,.vue',
  )
  .option(
    '--ignore <glob>',
    'extra ignore pattern (repeatable), on top of the built-in defaults',
    (val, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option('--no-respect-gitignore', "don't also honor the project's .gitignore")
  .option(
    '--methods <list>',
    'comma-separated console methods to remove (warn/error are deliberately not in the default — often legitimate)',
    'log,debug',
  )
  .option('--no-debugger', "don't remove bare debugger; statements")
  .option('--dry-run', 'preview changes without writing anything', false)
  .option('-y, --yes', 'apply the changes (without this, it only previews)', false)
  .option('--diff', 'include a unified diff per changed file', false)
  .option('--json', 'machine-readable output', false)
  .option('--quiet', 'suppress output when there is nothing to report', false)
  .option('--plain', 'disable color/banner/celebration copy, even in a real terminal', false)
  .action(
    (
      paths: string[],
      options: {
        cwd: string
        ext: string
        ignore: string[]
        respectGitignore: boolean
        methods: string
        debugger: boolean
        dryRun: boolean
        yes: boolean
        diff: boolean
        json: boolean
        quiet: boolean
        plain: boolean
      },
    ) => {
      const report = runConsoleStrip({
        paths,
        cwd: resolve(options.cwd),
        extensions: options.ext.split(',').map((e) => e.trim()),
        ignoreGlobs: options.ignore,
        respectGitignore: options.respectGitignore,
        methods: options.methods.split(',').map((m) => m.trim()),
        debugger: options.debugger,
        dryRun: options.dryRun,
        yes: options.yes,
        diff: options.diff,
      })

      if (options.json) {
        console.log(JSON.stringify(report, null, 2))
      } else {
        const text = renderConsoleStripReport(report, {
          quiet: options.quiet,
          plain: options.plain,
        })
        if (text) console.log(text)
      }

      process.exitCode = report.exitCode
    },
  )

program
  .command('dead-exports')
  .description(
    "Find named exports nothing in the project imports — a library's own public entry points are exempt by default",
  )
  .argument('[paths...]', 'files/directories to process', [])
  .option('--cwd <path>', 'root paths are resolved against', process.cwd())
  .option('--ext <list>', 'comma-separated extensions to include', '.ts,.tsx,.js,.jsx,.cjs,.mjs')
  .option(
    '--ignore <glob>',
    'extra ignore pattern (repeatable), on top of the built-in defaults',
    (val, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option('--no-respect-gitignore', "don't also honor the project's .gitignore")
  .option(
    '--entry <path>',
    'extra public-entry file (repeatable) — exports from it are exempt, same as auto-detected ones',
    (val, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option('--strict', 'also flag exports from public entry points, not just internal files', false)
  .option(
    '--no-workspace',
    "don't auto-detect a pnpm/npm/yarn workspace for cross-package resolution",
  )
  .option('--json', 'machine-readable output', false)
  .option('--quiet', 'suppress output when there is nothing to report', false)
  .option('--plain', 'disable color/banner/celebration copy, even in a real terminal', false)
  .action(
    (
      paths: string[],
      options: {
        cwd: string
        ext: string
        ignore: string[]
        respectGitignore: boolean
        entry: string[]
        strict: boolean
        workspace: boolean
        json: boolean
        quiet: boolean
        plain: boolean
      },
    ) => {
      const report = runDeadExports({
        paths,
        cwd: resolve(options.cwd),
        extensions: options.ext.split(',').map((e) => e.trim()),
        ignoreGlobs: options.ignore,
        respectGitignore: options.respectGitignore,
        entry: options.entry,
        strict: options.strict,
        workspace: options.workspace,
      })

      if (options.json) {
        console.log(JSON.stringify(report, null, 2))
      } else {
        const text = renderDeadExportsReport(report, { quiet: options.quiet, plain: options.plain })
        if (text) console.log(text)
      }

      process.exitCode = report.exitCode
    },
  )

program
  .command('case-check')
  .description(
    "Find imports whose case doesn't match the real file on disk — works on Windows/Mac, breaks on Linux CI",
  )
  .argument('[paths...]', 'files/directories to process', [])
  .option('--cwd <path>', 'root paths are resolved against', process.cwd())
  .option(
    '--ext <list>',
    'comma-separated extensions to include',
    '.ts,.tsx,.js,.jsx,.cjs,.mjs,.vue',
  )
  .option(
    '--ignore <glob>',
    'extra ignore pattern (repeatable), on top of the built-in defaults',
    (val, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option('--no-respect-gitignore', "don't also honor the project's .gitignore")
  .option('--tsconfig <path>', 'tsconfig.json to read path aliases from (auto-detected by default)')
  .option(
    '--fix',
    'rewrite mismatched specifiers to their real case (alias-resolved ones excluded)',
    false,
  )
  .option('--dry-run', 'preview changes without writing anything', false)
  .option('-y, --yes', 'apply the changes (without this, it only previews)', false)
  .option('--diff', 'include a unified diff per changed file', false)
  .option('--json', 'machine-readable output', false)
  .option('--quiet', 'suppress output when there is nothing to report', false)
  .option('--plain', 'disable color/banner/celebration copy, even in a real terminal', false)
  .action(
    (
      paths: string[],
      options: {
        cwd: string
        ext: string
        ignore: string[]
        respectGitignore: boolean
        tsconfig?: string
        fix: boolean
        dryRun: boolean
        yes: boolean
        diff: boolean
        json: boolean
        quiet: boolean
        plain: boolean
      },
    ) => {
      const report = runCaseCheck({
        paths,
        cwd: resolve(options.cwd),
        extensions: options.ext.split(',').map((e) => e.trim()),
        ignoreGlobs: options.ignore,
        respectGitignore: options.respectGitignore,
        ...(options.tsconfig ? { tsconfig: options.tsconfig } : {}),
        fix: options.fix,
        dryRun: options.dryRun,
        yes: options.yes,
        diff: options.diff,
      })

      if (options.json) {
        console.log(JSON.stringify(report, null, 2))
      } else {
        const text = renderCaseCheckReport(report, { quiet: options.quiet, plain: options.plain })
        if (text) console.log(text)
      }

      process.exitCode = report.exitCode
    },
  )

program
  .command('exports-doctor')
  .description(
    "Verify package.json's declared main/module/types/bin/exports paths actually resolve on disk",
  )
  .argument('[dir]', 'package directory to check', '.')
  .option('--json', 'machine-readable output', false)
  .option('--quiet', 'suppress output when there is nothing to report', false)
  .option('--plain', 'disable color/banner/celebration copy, even in a real terminal', false)
  .action((dir: string, options: { json: boolean; quiet: boolean; plain: boolean }) => {
    const report = runExportsDoctor({ dir: resolve(dir) })

    if (options.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      const text = renderExportsDoctorReport(report, { quiet: options.quiet, plain: options.plain })
      if (text) console.log(text)
    }

    process.exitCode = report.exitCode
  })

program
  .command('readme-check')
  .description('Typecheck fenced ts/tsx code blocks in README/docs against the real, built package')
  .argument('[dir]', 'package directory to check against', '.')
  .option(
    '--file <path>',
    'markdown file to check, relative to [dir] (repeatable) — default: README.md',
    (val, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option('--lang <list>', 'comma-separated fenced-block languages to check', 'ts')
  .option(
    '--tsconfig <path>',
    'tsconfig.json to read compiler options from (auto-detected by default)',
  )
  .option('--json', 'machine-readable output', false)
  .option('--quiet', 'suppress output when there is nothing to report', false)
  .option('--plain', 'disable color/banner/celebration copy, even in a real terminal', false)
  .action(
    (
      dir: string,
      options: {
        file: string[]
        lang: string
        tsconfig?: string
        json: boolean
        quiet: boolean
        plain: boolean
      },
    ) => {
      const report = runReadmeCheck({
        dir: resolve(dir),
        files: options.file,
        langs: options.lang.split(',').map((l) => l.trim().toLowerCase()),
        ...(options.tsconfig ? { tsconfig: options.tsconfig } : {}),
      })

      if (options.json) {
        console.log(JSON.stringify(report, null, 2))
      } else {
        const text = renderReadmeCheckReport(report, { quiet: options.quiet, plain: options.plain })
        if (text) console.log(text)
      }

      process.exitCode = report.exitCode
    },
  )

program.parse(process.argv)
