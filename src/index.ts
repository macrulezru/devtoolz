export { stripComments } from './commands/strip-comments/core.js'
export type { StripCommentsOptions, StripCommentsResult } from './commands/strip-comments/core.js'

export { stripVueComments } from './commands/strip-comments/vue.js'

export { runStripComments } from './commands/strip-comments/run.js'
export type {
  StripCommentsRunOptions,
  StripCommentsFileChange,
  StripCommentsReport,
} from './commands/strip-comments/run.js'

export { renderStripCommentsReport } from './commands/strip-comments/report.js'

export { stripConsole } from './commands/console-strip/core.js'
export type {
  StripConsoleOptions,
  StripConsoleResult,
  SkippedCall,
  SkipReason,
} from './commands/console-strip/core.js'

export { stripConsoleVue } from './commands/console-strip/vue.js'

export { runConsoleStrip } from './commands/console-strip/run.js'
export type {
  ConsoleStripRunOptions,
  ConsoleStripFileChange,
  ConsoleStripSkipped,
  ConsoleStripReport,
} from './commands/console-strip/run.js'

export { renderConsoleStripReport } from './commands/console-strip/report.js'

export { analyzeDeadExports } from './commands/dead-exports/core.js'
export type {
  DeadExportFinding,
  DeadExportsAnalysis,
  AnalyzeOptions,
} from './commands/dead-exports/core.js'

export { runDeadExports } from './commands/dead-exports/run.js'
export type { DeadExportsRunOptions, DeadExportsReport } from './commands/dead-exports/run.js'

export { renderDeadExportsReport } from './commands/dead-exports/report.js'

export { detectWorkspace } from './utils/workspace.js'
export type { WorkspaceInfo, WorkspacePackage } from './utils/workspace.js'

export { analyzeCircularImports } from './commands/circular-imports/core.js'
export type {
  CircularImportFinding,
  CircularImportsAnalysis,
  CircularImportsAnalyzeOptions,
} from './commands/circular-imports/core.js'

export { runCircularImports } from './commands/circular-imports/run.js'
export type {
  CircularImportsRunOptions,
  CircularImportsFileFinding,
  CircularImportsReport,
} from './commands/circular-imports/run.js'

export { renderCircularImportsReport } from './commands/circular-imports/report.js'

export { analyzeUnusedDeps } from './commands/unused-deps/core.js'
export type { UnusedDepsFinding, UnusedDepsAnalysis } from './commands/unused-deps/core.js'
export type { AnalyzeOptions as UnusedDepsAnalyzeOptions } from './commands/unused-deps/core.js'

export { runUnusedDeps } from './commands/unused-deps/run.js'
export type { UnusedDepsRunOptions, UnusedDepsReport } from './commands/unused-deps/run.js'

export { renderUnusedDepsReport } from './commands/unused-deps/report.js'

export { packageNameFromSpecifier } from './commands/unused-deps/package-name.js'
export { resolvePackageDir, declaredBinNames } from './commands/unused-deps/disk-resolve.js'

export { analyzeFile } from './utils/parse-module.js'
export type {
  FileAnalysis,
  ExportedName,
  ReexportEntry,
  ImportedName,
} from './utils/parse-module.js'

export { resolveRelativeSpecifier } from './utils/resolve-specifier.js'

export { resolvePublicEntries } from './commands/dead-exports/entry.js'
export { findNearestPackageDir } from './utils/find-package-dir.js'

export { checkSpecifierCase } from './commands/case-check/resolve-case.js'
export type { CaseCheckOutcome } from './commands/case-check/resolve-case.js'

export { checkFile } from './commands/case-check/core.js'
export type { CaseCheckFinding } from './commands/case-check/core.js'

export { runCaseCheck } from './commands/case-check/run.js'
export type {
  CaseCheckRunOptions,
  CaseCheckFileFinding,
  CaseCheckFileChange,
  CaseCheckReport,
} from './commands/case-check/run.js'

export { renderCaseCheckReport } from './commands/case-check/report.js'

export {
  findTsconfig,
  loadTsconfigPaths,
  resolveAlias,
} from './commands/case-check/tsconfig-paths.js'
export type { TsconfigPaths } from './commands/case-check/tsconfig-paths.js'

export { checkPackage } from './commands/exports-doctor/core.js'
export type {
  ExportsDoctorFinding,
  ExportsDoctorResult,
  FindingKind,
} from './commands/exports-doctor/core.js'

export { runExportsDoctor } from './commands/exports-doctor/run.js'
export type { ExportsDoctorRunOptions, ExportsDoctorReport } from './commands/exports-doctor/run.js'

export { renderExportsDoctorReport } from './commands/exports-doctor/report.js'

export { extractCodeBlocks } from './commands/readme-check/extract.js'
export type { CodeBlock } from './commands/readme-check/extract.js'

export { typecheckBlock } from './commands/readme-check/typecheck.js'
export type { BlockDiagnostic } from './commands/readme-check/typecheck.js'

export { loadTsconfig } from './utils/load-tsconfig.js'
export type { LoadedTsconfig, LoadTsconfigResult } from './utils/load-tsconfig.js'

export { checkMarkdownFile } from './commands/readme-check/core.js'
export type { ReadmeCheckFinding, ReadmeCheckFileResult } from './commands/readme-check/core.js'

export { runReadmeCheck } from './commands/readme-check/run.js'
export type { ReadmeCheckRunOptions, ReadmeCheckReport } from './commands/readme-check/run.js'

export { renderReadmeCheckReport } from './commands/readme-check/report.js'

export { analyzeEmptyCatch } from './commands/empty-catch/core.js'
export type { EmptyCatchFinding } from './commands/empty-catch/core.js'

export { analyzeEmptyCatchVue } from './commands/empty-catch/vue.js'

export { runEmptyCatch } from './commands/empty-catch/run.js'
export type {
  EmptyCatchRunOptions,
  EmptyCatchFileFinding,
  EmptyCatchReport,
} from './commands/empty-catch/run.js'

export { renderEmptyCatchReport } from './commands/empty-catch/report.js'

export { analyzeTodoReport, buildTagMatcher, DEFAULT_TAGS } from './commands/todo-report/core.js'
export type { TodoFinding } from './commands/todo-report/core.js'

export { analyzeTodoReportVue } from './commands/todo-report/vue.js'

export { runTodoReport } from './commands/todo-report/run.js'
export type {
  TodoReportRunOptions,
  TodoFileFinding,
  TodoReportReport,
} from './commands/todo-report/run.js'

export { renderTodoReportReport } from './commands/todo-report/report.js'

export {
  analyzeScriptsCheck,
  extractMentionedScripts,
  isScriptMentioned,
  isReservedLifecycleScript,
} from './commands/scripts-check/core.js'
export type { ScriptsCheckFinding, ScriptSource } from './commands/scripts-check/core.js'

export { runScriptsCheck } from './commands/scripts-check/run.js'
export type { ScriptsCheckRunOptions, ScriptsCheckReport } from './commands/scripts-check/run.js'

export { renderScriptsCheckReport } from './commands/scripts-check/report.js'

export {
  parseTestFile,
  hasMatchingSource,
  candidateSourceDirs,
} from './commands/orphan-tests/core.js'
export type { OrphanTestFinding } from './commands/orphan-tests/core.js'

export { runOrphanTests } from './commands/orphan-tests/run.js'
export type { OrphanTestsRunOptions, OrphanTestsReport } from './commands/orphan-tests/run.js'

export { renderOrphanTestsReport } from './commands/orphan-tests/report.js'

export { findTsIgnoreDirectives, blankDirectives } from './commands/stale-ts-ignore/core.js'
export type { TsIgnoreDirective } from './commands/stale-ts-ignore/core.js'

export {
  extractVueScript,
  findVueTsIgnoreDirectives,
  type VueScript,
} from './commands/stale-ts-ignore/vue.js'

export { runProjectTypecheck, checkIsolatedFile } from './commands/stale-ts-ignore/check.js'

export { runStaleTsIgnore } from './commands/stale-ts-ignore/run.js'
export type {
  StaleTsIgnoreRunOptions,
  StaleTsIgnoreFinding,
  StaleTsIgnoreReport,
} from './commands/stale-ts-ignore/run.js'

export { renderStaleTsIgnoreReport } from './commands/stale-ts-ignore/report.js'

export {
  runFullCheck,
  FULL_CHECK_COMMAND_NAMES,
  SLOW_FULL_CHECK_COMMAND,
} from './commands/full-check/run.js'
export type {
  FullCheckCommandName,
  FullCheckCommandResult,
  FullCheckRunOptions,
  FullCheckReport,
} from './commands/full-check/run.js'

export { renderFullCheckReport } from './commands/full-check/report.js'

export { walk } from './utils/walk.js'
export type { WalkOptions } from './utils/walk.js'
