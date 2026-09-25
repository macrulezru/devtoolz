# **DevToolz**

![DevToolz](https://github.com/macrulezru/assets/blob/master/packages-images/devtoolz.webp?raw=true)

A small toolbox of CLI commands that automate routine dev chores — the
kind of thing you'd otherwise do with a half-remembered regex or by hand,
right before a commit. One binary, one subcommand per chore, each safe by
default (preview first, `-y` to actually write anything).

Real AST parsing where it matters, not naive regex — a string, template
literal, or regex literal that happens to _contain_ the text a command is
looking for is never touched.

## Features

- **`strip-comments`** — removes `//`, `/* */`, `/** */`, and `<!-- -->`
  comments from source files in place. `--keep-jsdoc` leaves a `/** */`
  directly above an exported declaration alone (so exported types/props
  keep their IDE tooltips); everything else goes. Handles `.vue` files —
  the `<script>` block through the same parser, `<!-- -->` in `<template>`
  through a line-aware scan.
- **`console-strip`** — removes `console.log`/`console.debug`/`debugger`
  statements left in by mistake. `console.warn`/`console.error` are
  deliberately _not_ touched by default — often legitimate production
  logging, not debug leftovers (`--methods` overrides the list). Only
  ever deletes a call that's a whole statement on its own — one that's
  part of a larger expression (`const r = console.log(x) || y`) or sits
  inside a brace-less `if`/`while`/`for` body is left alone and reported
  separately, never guessed at.
- **`dead-exports`** — finds named exports nothing in the project
  imports. Aware of what "dead" actually means for a published library:
  a package's own public entry points (auto-detected from
  `package.json`'s `exports`/`main`/`module`/`bin`) are exempt by default
  — being unused _inside the repo_ isn't the same as being unused,
  that's the whole point of exporting it. Traces re-export chains
  (`export { x } from './y'`, `export * from './y'`) back to where a
  symbol is really declared, and auto-detects a pnpm/npm/yarn workspace
  so a sibling package importing your export doesn't read as dead either.
  `--strict` checks the entry points too, for when you actually want that.
- **`unused-deps`** — finds `package.json` dependencies nothing imports,
  and the reverse: a package genuinely imported but never declared (a
  "phantom" dependency, working only because something else hoisted it
  into `node_modules`). Knows about the usual ways a dependency is used
  without ever being imported — invoked from `scripts`/`lint-staged` by
  its bin name, referenced as a string or bare key in a config file
  (`vitest.config.ts`'s `environment: 'happy-dom'`,
  `postcss.config.js`'s `plugins: { autoprefixer: {} }`) — plus a small,
  explicit list of packages no static analysis could ever catch
  (`@types/*`, `typescript`, `@vitest/coverage-*`, `postcss`/`sass`).
  `--strict` checks that last list too, for a manual audit.
- **`circular-imports`** — finds import cycles (`A → B → … → A`) in your
  own code — the kind that can silently produce `undefined` at module
  load time in ESM. Reports every cycle found, not just the first, as
  its full chain. A cycle made entirely of `import type` is harmless at
  runtime (types are erased) and hidden by default — `--include-types`
  shows those too, clearly marked.
- **`case-check`** — finds imports whose case doesn't match the real
  file on disk. Windows and macOS are case-insensitive by default, so
  `import './foo'` against a real `Foo.ts` works fine right up until it
  hits Linux CI. Checks every path segment, not just the file name;
  resolves `tsconfig.json` path aliases (`@/...`) too. `--fix` rewrites
  the mismatched specifier to its real case (alias-resolved ones excluded
  — see `--help`).
- **`exports-doctor`** — resolves every path `package.json` declares
  (`main`/`module`/`types`/`typings`/`bin`/`exports`, including nested
  condition objects, subpath maps, and fallback arrays) against what's
  actually on disk. Catches a file that doesn't exist, one that exists
  under a different case, a `bin` entry missing its `#!/usr/bin/env node`
  shebang, and — the sneaky one — a subpath whose runtime conditions
  resolve fine but that never declares `types` at all anywhere under it,
  so a TypeScript consumer silently gets no types with no error anywhere.
- **`readme-check`** — extracts fenced `ts` code blocks from README/docs
  and actually typechecks them with the TypeScript Compiler API against
  the package's own `tsconfig.json` — never executes anything, only
  compiles. The virtual file lives at the package root, so both relative
  imports and a self-referencing import of the package's own published
  name (`import { x } from 'my-package'`) resolve exactly as they would
  for a real consumer. Each block is checked independently; "Cannot find
  name" from a block that assumes context set up elsewhere in the doc,
  and a handful of other structurally-unreliable diagnostic codes, are
  dropped rather than reported as noise (see `--help`/features.md for
  exactly which). `--lang` opts into `tsx`/`js`/`jsx` (default: `ts`
  only — `tsx` needs the package to actually configure JSX itself).
- **`empty-catch`** — finds `catch` blocks that do nothing with the
  error, or do so little it's effectively swallowed: fully empty, or a
  body that's nothing but `console.*` calls with no `throw`, no write to
  an outer-scope variable, no meaningful `return`. Syntactically valid
  code that ordinary lint rules can't catch — needs a semantic check, not
  a syntactic one. A comment inside the block (found via a real token
  scan, not text matching) exempts the finding, same principle as
  ESLint's `no-empty` for documented empty blocks. Handles `.vue` files.
- **`todo-report`** — summarizes `TODO`/`FIXME`/`HACK` comments across
  the project — file:line plus the note's actual text, including one
  wrapped across several `//` lines or a multi-line `/* */` block, joined
  back into one readable line. `--tags` configures the list (default
  `TODO,FIXME,HACK`); `--max <n>` turns the default "fail on any finding"
  into a ratchet for a project that's knowingly living with existing
  debt. Handles `.vue` files, including `<!-- -->` template comments.
- **`scripts-check`** — cross-checks `package.json`'s `scripts` against
  README/docs and `.github/workflows/*.yml`: a mentioned-but-undeclared
  script (`npm run X`, `npm test`/`start`, `yarn`/`pnpm run X`) is a
  real broken link — renamed a script, forgot to update the docs or CI —
  and, as a weaker signal, a declared script nothing documents. npm's
  own reserved lifecycle names (`prepublishOnly`,
  `preinstall`, `postinstall`, `prepare`, any `pre*`/`post*` for another
  declared script) are exempt from the second direction — npm calls
  those itself. A CI step under its own `working-directory:` (a `demo/`
  subproject, say) is understood to belong to a different `package.json`
  entirely, not flagged against this one's.
- **`orphan-tests`** — finds test files whose source disappeared —
  renamed or deleted, the test still green, testing nothing real
  anymore. Reliable only under a simple naming convention: co-located
  (`Foo.test.ts` next to `Foo.ts`, including a sibling `__tests__`/`tests`
  directory one level down), or an explicit `--source-dir`/`--test-dir`
  mirror. A scenario/integration test with no single corresponding source
  file is a known false positive under that strict rule — `--ignore`
  is the documented way to exclude it, not something this command tries
  to guess.
- **`stale-ts-ignore`** — finds a `// @ts-ignore` that no longer
  suppresses anything: the code below it was fixed, the comment wasn't
  removed. There's no compiler API for "was this specific directive
  needed" — this runs a real project-wide typecheck twice (once as-is,
  once with every directive masked out) and compares the delta at each
  directive's own line, so it's the most expensive command here, and
  says so up front when there's real work to do. Skips the expensive
  part entirely when there's not a single `@ts-ignore` in the project.
  `.vue` files get an isolated per-file check (same technique as
  `readme-check`'s own virtual-file typechecking) — a plain
  `ts.Program` can't include `.vue` in a whole-project run at all.

`strip-comments`, `console-strip`, and `case-check` share the same safety
model: `--dry-run` (or just running with neither `--dry-run` nor `-y`)
only previews, `-y`/`--yes` is required to actually write anything,
`--diff` shows a real unified diff per file. `dead-exports`,
`unused-deps`, `circular-imports`, `exports-doctor`, `readme-check`,
`empty-catch`, `todo-report`, `scripts-check`, `orphan-tests`, and
`stale-ts-ignore` are all read-only — none of them ever write anything,
there's nothing to preview or apply. Every command supports `--json` for
machine-readable output.

## Tone

Not dead silent, not relentlessly jokey either — a small banner and some
personality when everything comes back clean, nothing cute mixed into the
actual findings list, which stays in aligned, colored columns (file in
white, count/tag in dim grey) for quick scanning. Auto-disables (banner,
color, celebration copy) the moment output isn't a real interactive
terminal — piped, `CI` set, `NO_COLOR` set — on top of the explicit
`--quiet`/`--plain` flags.

## Requirements

- Node.js 20+

## Installation

```bash
npm install -g @macrulez/devtoolz
```

Or run it without installing:

```bash
npx @macrulez/devtoolz strip-comments src --dry-run
```

## Quick start

```bash
devtoolz strip-comments src --dry-run --diff   # preview, see exactly what would change
devtoolz strip-comments src -y                 # actually strip

devtoolz console-strip src --dry-run           # same idea, for console.log/debugger
devtoolz console-strip src -y

devtoolz dead-exports src                      # report-only, nothing to apply

devtoolz unused-deps                           # package.json deps vs what's actually imported
devtoolz unused-deps path/to/package --strict   # also check @types/*, typescript, etc.

devtoolz circular-imports src                  # find import cycles (A -> B -> ... -> A)

devtoolz case-check src --fix --diff --dry-run # preview a case fix
devtoolz case-check src --fix -y               # apply it

devtoolz exports-doctor                        # check package.json in the current directory
devtoolz exports-doctor path/to/package         # or a specific package directory

devtoolz readme-check                          # typecheck ts blocks in ./README.md
devtoolz readme-check --file docs/guide.md      # check another doc instead/as well

devtoolz empty-catch src                       # find catch blocks that swallow the error

devtoolz todo-report src                       # summarize TODO/FIXME/HACK comments
devtoolz todo-report src --max 20              # ratchet: fail only once findings exceed 20

devtoolz scripts-check                         # package.json scripts vs README/CI mentions

devtoolz orphan-tests src                      # test files whose source disappeared

devtoolz stale-ts-ignore                       # find @ts-ignore comments suppressing nothing
```

Every command has built-in `--help` — `devtoolz --help` lists every
command with its own flags inline (plus a "Common options" block for the
handful genuinely shared by every command); `devtoolz <command> --help`
for one command's full flag list with defaults.

## Example output

`devtoolz console-strip src --dry-run --diff` against a file with a mix of
cases:

```
🧰 devtoolz, reporting for duty

Scanned 1 file.

Would strip console/debugger statements in 1 file(s):
  src/example.ts  3 statements

(nothing written — pass -y to apply, or --dry-run to keep previewing)

── src/example.ts (3 statements) ─────────────────────────────────────
@@ -1,13 +1,7 @@
 const s = 'console.log(fooled ya)'
-console.log('leftover debug')
 function f(x) {
   if (x) console.log('braceless, left alone')
   const r = console.log(x) || 42
   console.warn('kept by default')
-  debugger
   return x
 }
-console.log(
-  'multi',
-  'line',
-)

2 left in place, needs a manual look:
  - src/example.ts:4:10 — inside a single-statement body without braces — console.log('braceless, left alone')
  - src/example.ts:5:13 — part of a larger expression, not its own statement — console.log(x)
```

Note what _didn't_ change: the string literal that happens to contain the
text `console.log(`, and `console.warn` (not in the default method list).

`devtoolz dead-exports src` against a small package:

```
🧰 devtoolz, reporting for duty

Scanned 3 files.

2 dead exports found:
  src/helpers.ts:1  unusedHelper
  src/types.ts:1    Options       (type)
```

`devtoolz unused-deps` against a package with one truly unused dependency
and one phantom (imported but never declared):

```
🧰 devtoolz, reporting for duty

Scanned 1 file.

2 problems found:
  phantom  dotenv    resolves from C:\tmp\demo-pkg\node_modules\dotenv — not declared in package.json
  unused   left-pad  (dependencies, not imported anywhere)
```

`devtoolz circular-imports src` against two files that import each other:

```
🧰 devtoolz — chores, automated

Scanned 2 files.

1 circular import found:

  src/order.ts
  → src/user.ts
  → src/order.ts
```

`devtoolz case-check src --fix --diff --dry-run` after a file got renamed
`Helper.ts` → `helper.ts` on someone's Mac, with the import never updated:

```
🧰 devtoolz — chores, automated

Scanned 2 files.

1 case mismatch found:
  src/main.ts:1:23  ./helper.js → ./Helper.js

Would fix 1 import(s) in 1 file(s) — pass -y to apply.

── src/main.ts (1 import) ────────────────────────────────────────────
@@ -1,2 +1,2 @@
-import { greet } from './helper.js'
+import { greet } from './Helper.js'
 console.log(greet())
```

`devtoolz exports-doctor` against a package whose `./cdn` subpath has an
`import` condition but nobody ever added a `types` one (the exact bug
class this was built to catch — a build that "works" while TypeScript
consumers get nothing):

```
🧰 devtoolz — chores, automated

Checked demo-pkg's declared exports.

1 problem found:
  exports["./cdn"]  ./dist/cdn/index.js  runtime resolves fine, but no types declared for this entry at all
```

`devtoolz readme-check` against a README whose example doesn't actually
match the package's own types:

```
🧰 devtoolz

Typechecked 1 code block across 1 file.

1 problem found:
  README.md:6:7  ts  Type 'string' is not assignable to type 'number'.
```

`devtoolz empty-catch src` against a `catch` block that only logs the
error and never rethrows or handles it:

```
Scanned 1 file.

1 problem found:
  src/example.ts:4:5  console-only  only logged, never handled — silently swallowed either way
```

`devtoolz todo-report src` against a `TODO` wrapped across several `//`
lines — joined back into one readable note, not cut off mid-sentence:

```
Scanned 1 file.

1 comment found (TODO: 1):
  src/example.ts:9:4  TODO  TODO: replace the hardcoded timeout below with a value read from config once loadConfig() above actually works end to end
```

`devtoolz scripts-check` against a package whose README has a typo'd
script name, and two real scripts nothing documents:

```
Checked 1 source against package.json's scripts.

3 problems found:
  README.md:4     buld    mentioned here, but not in package.json scripts
  package.json:4  build   in package.json scripts, but not mentioned anywhere checked
  package.json:6  deploy  in package.json scripts, but not mentioned anywhere checked
```

`devtoolz orphan-tests src` after `parseQuery.ts` was renamed/removed but
its test survived:

```
Scanned 3 files.

1 orphan test found:
  src/parseQuery.test.ts  orphan  no matching source found (tried .ts, .tsx, .js, .jsx, .mjs, .cjs, .vue)
```

`devtoolz stale-ts-ignore` against a `@ts-ignore` above a line that
typechecks cleanly on its own — the code was fixed, the comment wasn't:

```
Checked 1 @ts-ignore directive.

1 stale @ts-ignore found:
  src/example.ts:2  @ts-ignore  doesn't suppress anything — the line below it typechecks cleanly without it
```

## Development

```bash
npm install
npm run build      # tsc -> dist/
npm test           # vitest
npm run lint       # eslint .
npm run format     # prettier --check .
npm run typecheck  # tsc --noEmit
```

---

## Documentation & links

- 📖 **Full documentation:** [npm.vuecraft.ru/en/packages/devtoolz](https://npm.vuecraft.ru/en/packages/devtoolz/guide/overview.html)
- 🌐 **VueCraft:** [vuecraft.ru/en](https://vuecraft.ru/en)
- 👤 **Author:** [macrulez.ru/en](https://macrulez.ru/en)
- 💻 **GitHub:** [macrulezru/devtoolz](https://github.com/macrulezru/devtoolz)
- 📦 **NPM:** [@macrulez/devtoolz](https://www.npmjs.com/package/@macrulez/devtoolz)
- 🐛 **Issues:** [github.com/macrulezru/devtoolz/issues](https://github.com/macrulezru/devtoolz/issues)

---

## License

MIT

---

## 💖 Support the project

Open source takes time and effort. If this library saves you time or brings value, consider supporting further development.

<a href="https://donate.cryptocloud.plus/M6O34NIN" target="_blank">
  <img src="https://img.shields.io/badge/Donate-CryptoCloud-8A2BE2?style=for-the-badge&logo=cryptocurrency&logoColor=white" alt="Donate via CryptoCloud">
</a>

Thank you for being part of this journey. ❤️
