import { readFileSync } from 'node:fs'
import { analyzeFile } from '../../utils/parse-module.js'
import { resolveRelativeSpecifier } from '../../utils/resolve-specifier.js'

export interface CircularImportFinding {
  /** the cycle, in edge order, NOT repeating the start file at the end (e.g. [A, B, C] means A -> B -> C -> A) */
  files: string[]
  /** true only when every edge in this specific cycle is a type-only import — harmless at runtime, types are erased */
  typeOnly: boolean
}

export interface CircularImportsAnalysis {
  findings: CircularImportFinding[]
  filesAnalyzed: number
}

export interface CircularImportsAnalyzeOptions {
  /** also report cycles made entirely of `import type` edges. default false */
  includeTypes: boolean
}

interface Edge {
  to: string
  typeOnly: boolean
}

/**
 * One graph edge per (file, targetFile) pair, not per import statement —
 * multiple imports between the same two files collapse into one edge.
 * The edge is type-only only if EVERY import between them is; a single
 * value-level import between the pair makes the whole edge value-level.
 */
function buildGraph(files: string[]): Map<string, Edge[]> {
  const graph = new Map<string, Edge[]>()

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const analysis = analyzeFile(text, file)
    const edgesByTarget = new Map<string, boolean>() // target -> typeOnly so far

    for (const imp of analysis.imports) {
      if (!imp.from.startsWith('.')) continue // bare specifiers (third-party packages) aren't part of this graph
      const target = resolveRelativeSpecifier(file, imp.from)
      if (!target || !files.includes(target)) continue // outside the scanned set — nothing to walk into

      const existing = edgesByTarget.get(target)
      edgesByTarget.set(target, existing === undefined ? imp.isType : existing && imp.isType)
    }

    graph.set(
      file,
      [...edgesByTarget].map(([to, typeOnly]) => ({ to, typeOnly })),
    )
  }

  return graph
}

/**
 * Every simple cycle is found via a DFS with an explicit recursion stack
 * (a "back edge" to a node still on the stack is a cycle) — not full
 * enumeration of every simple cycle in the graph (exponential in the
 * worst case, and overkill here): one representative cycle is reported
 * per strongly-connected cluster reached this way, matching how tools
 * like madge/circular-dependency-plugin report this in practice.
 */
function findCycles(graph: Map<string, Edge[]>): CircularImportFinding[] {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2
  const color = new Map<string, number>()
  const stack: string[] = []
  const found: CircularImportFinding[] = []
  const seenKeys = new Set<string>()

  function canonicalKey(cycleFiles: string[]): string {
    let minIdx = 0
    for (let i = 1; i < cycleFiles.length; i++) {
      if ((cycleFiles[i] as string) < (cycleFiles[minIdx] as string)) minIdx = i
    }
    return [...cycleFiles.slice(minIdx), ...cycleFiles.slice(0, minIdx)].join('\u0000')
  }

  function dfs(node: string): void {
    color.set(node, GRAY)
    stack.push(node)

    for (const edge of graph.get(node) ?? []) {
      const targetColor = color.get(edge.to) ?? WHITE
      if (targetColor === WHITE) {
        dfs(edge.to)
      } else if (targetColor === GRAY) {
        const startIdx = stack.indexOf(edge.to)
        const cycleFiles = stack.slice(startIdx)
        const key = canonicalKey(cycleFiles)
        if (!seenKeys.has(key)) {
          seenKeys.add(key)
          const typeOnly = isCycleTypeOnly(graph, cycleFiles)
          found.push({ files: cycleFiles, typeOnly })
        }
      }
    }

    stack.pop()
    color.set(node, BLACK)
  }

  for (const node of graph.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) dfs(node)
  }

  return found
}

function isCycleTypeOnly(graph: Map<string, Edge[]>, cycleFiles: string[]): boolean {
  for (let i = 0; i < cycleFiles.length; i++) {
    const from = cycleFiles[i] as string
    const to = cycleFiles[(i + 1) % cycleFiles.length] as string
    const edge = (graph.get(from) ?? []).find((e) => e.to === to)
    if (!edge?.typeOnly) return false
  }
  return true
}

export function analyzeCircularImports(
  files: string[],
  options: CircularImportsAnalyzeOptions,
): CircularImportsAnalysis {
  const graph = buildGraph(files)
  const allCycles = findCycles(graph)
  const findings = options.includeTypes ? allCycles : allCycles.filter((c) => !c.typeOnly)

  return { findings, filesAnalyzed: files.length }
}
