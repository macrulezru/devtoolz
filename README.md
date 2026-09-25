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

`strip-comments`, `console-strip`, and `case-check` share the same safety
model: `--dry-run` (or just running with neither `--dry-run` nor `-y`)
only previews, `-y`/`--yes` is required to actually write anything,
`--diff` shows a real unified diff per file. `dead-exports` is read-only,
it never writes anything — there's nothing to preview. Every command
supports `--json` for machine-readable output.

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

devtoolz case-check src --fix --diff --dry-run # preview a case fix
devtoolz case-check src --fix -y               # apply it

devtoolz exports-doctor                        # check package.json in the current directory
devtoolz exports-doctor path/to/package         # or a specific package directory

devtoolz readme-check                          # typecheck ts blocks in ./README.md
devtoolz readme-check --file docs/guide.md      # check another doc instead/as well
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
