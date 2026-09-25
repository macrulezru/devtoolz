import { createTwoFilesPatch } from 'diff'

// A real unified diff, not a hand-rolled approximation — this is the
// output someone reviews BEFORE trusting a tool that deletes code from
// their files, it has to be right, not "close enough".
export function unifiedDiff(file: string, before: string, after: string): string {
  const patch = createTwoFilesPatch(file, file, before, after, '', '', { context: 2 })
  // createTwoFilesPatch always appends a tab after the file name on the
  // --- / +++ header lines (meant to separate it from a timestamp), even
  // when no timestamp is given — trims the resulting trailing tab so the
  // header doesn't end in invisible whitespace.
  return patch.replace(/^(--- .+?|\+\+\+ .+?)\t$/gm, '$1')
}
