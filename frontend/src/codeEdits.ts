export interface CodeEdit {
  startLine: number;
  endLine: number;
  original: string;
  replacement: string;
}

// Only apply a suggestion to the exact source it was prepared against.
export function applyCodeEdit(
  code: string,
  edit: CodeEdit,
): string | undefined {
  const lines = code.split('\n');
  if (
    !Number.isInteger(edit.startLine) ||
    !Number.isInteger(edit.endLine) ||
    edit.startLine < 1 ||
    edit.endLine < edit.startLine ||
    edit.endLine > lines.length ||
    lines.slice(edit.startLine - 1, edit.endLine).join('\n') !== edit.original
  )
    return undefined;
  const result = [
    ...lines.slice(0, edit.startLine - 1),
    ...(edit.replacement === '' ? [] : edit.replacement.split('\n')),
    ...lines.slice(edit.endLine),
  ].join('\n');
  return result.length <= 30_000 ? result : undefined;
}
