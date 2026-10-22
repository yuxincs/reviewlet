import { Parser, Query, type Language as Grammar } from 'web-tree-sitter';
import { highlightQuery, type ParsedLanguage } from './queries';

export type SyntaxKind =
  | 'comment'
  | 'string'
  | 'number'
  | 'constant'
  | 'keyword'
  | 'variable'
  | 'property'
  | 'function'
  | 'type'
  | 'namespace'
  | 'tag'
  | 'operator'
  | 'punctuation';
export interface SyntaxToken {
  start: number;
  end: number;
  kind: SyntaxKind;
}
interface Capture extends SyntaxToken {
  width: number;
}
const priority: Record<SyntaxKind, number> = {
  comment: 12,
  string: 11,
  keyword: 10,
  constant: 9,
  function: 8,
  type: 7,
  tag: 6,
  namespace: 5,
  property: 4,
  number: 3,
  operator: 2,
  punctuation: 1,
  variable: 0,
};

function flatten(captures: Capture[]): SyntaxToken[] {
  const starts = new Map<number, Capture[]>();
  const ends = new Map<number, Capture[]>();
  for (const capture of captures) {
    starts.set(capture.start, [...(starts.get(capture.start) ?? []), capture]);
    ends.set(capture.end, [...(ends.get(capture.end) ?? []), capture]);
  }
  const boundaries = [...new Set([...starts.keys(), ...ends.keys()])].sort(
    (a, b) => a - b,
  );
  const active = new Set<Capture>();
  const tokens: SyntaxToken[] = [];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index],
      end = boundaries[index + 1];
    for (const capture of ends.get(start) ?? []) active.delete(capture);
    for (const capture of starts.get(start) ?? []) active.add(capture);
    let best: Capture | undefined;
    for (const capture of active)
      if (
        !best ||
        capture.width < best.width ||
        (capture.width === best.width &&
          priority[capture.kind] > priority[best.kind])
      )
        best = capture;
    if (!best || end <= start) continue;
    const last = tokens.at(-1);
    if (last?.end === start && last.kind === best.kind) last.end = end;
    else tokens.push({ start, end, kind: best.kind });
  }
  return tokens;
}

export class SyntaxHighlighter {
  private readonly parser: Parser;
  private readonly query: Query;
  constructor(language: ParsedLanguage, grammar: Grammar) {
    this.query = new Query(grammar, highlightQuery(language, grammar));
    this.parser = new Parser();
    this.parser.setLanguage(grammar);
  }
  highlight(code: string): SyntaxToken[][] {
    const lines = code.split('\n');
    const captures: Capture[][] = lines.map(() => []);
    const tree = this.parser.parse(code);
    if (!tree) return captures;
    try {
      for (const { name, node } of this.query.captures(tree.rootNode)) {
        if (node.endIndex <= node.startIndex) continue;
        for (
          let row = node.startPosition.row;
          row <= node.endPosition.row && row < lines.length;
          row++
        ) {
          const start =
            row === node.startPosition.row ? node.startPosition.column : 0;
          const end =
            row === node.endPosition.row
              ? node.endPosition.column
              : lines[row].length;
          if (end > start)
            captures[row].push({
              start,
              end,
              kind: name as SyntaxKind,
              width: node.endIndex - node.startIndex,
            });
        }
      }
      return captures.map(flatten);
    } finally {
      tree.delete();
    }
  }
  delete() {
    this.query.delete();
    this.parser.delete();
  }
}
