// Plain-text line/column lookup for commands that scan prose/YAML instead
// of parsing an AST (`readme-check`'s own markdown extraction does this
// inline; pulled out here the moment a second non-AST text scanner
// needed the same thing — `scripts-check`).

export function lineOf(text: string, index: number): number {
  return (text.slice(0, index).match(/\n/g) ?? []).length + 1
}

export function columnOf(text: string, index: number): number {
  const lastNewline = text.lastIndexOf('\n', index - 1)
  return index - lastNewline
}
