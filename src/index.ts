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

export { detectWorkspace } from './commands/dead-exports/workspace.js'
export type { WorkspaceInfo, WorkspacePackage } from './commands/dead-exports/workspace.js'

export { resolvePublicEntries, findNearestPackageDir } from './commands/dead-exports/entry.js'

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

export { loadCompilerOptions } from './commands/readme-check/tsconfig.js'
export type {
  LoadedCompilerOptions,
  LoadCompilerOptionsResult,
} from './commands/readme-check/tsconfig.js'

export { checkMarkdownFile } from './commands/readme-check/core.js'
export type { ReadmeCheckFinding, ReadmeCheckFileResult } from './commands/readme-check/core.js'

export { runReadmeCheck } from './commands/readme-check/run.js'
export type { ReadmeCheckRunOptions, ReadmeCheckReport } from './commands/readme-check/run.js'

export { renderReadmeCheckReport } from './commands/readme-check/report.js'

export { walk } from './utils/walk.js'
export type { WalkOptions } from './utils/walk.js'
