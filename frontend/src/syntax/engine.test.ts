// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Parser, Language } from 'web-tree-sitter';
import { SyntaxHighlighter, type SyntaxKind } from './engine';
import type { ParsedLanguage } from './queries';

const highlighters = new Map<ParsedLanguage, SyntaxHighlighter>();
beforeAll(async () => {
  await Parser.init({
    wasmBinary: await readFile(
      new URL(
        '../../node_modules/web-tree-sitter/web-tree-sitter.wasm',
        import.meta.url,
      ),
    ),
  });
  for (const language of [
    'javascript',
    'typescript',
    'python',
    'go',
  ] as const) {
    const name = language === 'typescript' ? 'tsx' : language;
    const grammar = await Language.load(
      new Uint8Array(
        await readFile(
          new URL(
            `../../node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter-${name}.wasm`,
            import.meta.url,
          ),
        ),
      ),
    );
    highlighters.set(language, new SyntaxHighlighter(language, grammar));
  }
});
afterAll(() => {
  for (const highlighter of highlighters.values()) highlighter.delete();
});
function tokens(code: string, language: ParsedLanguage, kind: SyntaxKind) {
  const lines = code.split('\n');
  return highlighters
    .get(language)!
    .highlight(code)
    .flatMap((row, index) =>
      row
        .filter((token) => token.kind === kind)
        .map((token) => lines[index].slice(token.start, token.end)),
    );
}
it.each([
  [
    'javascript',
    'function greet(name) {\n const message = "hello";\n return message + ',
    'function',
  ],
  [
    'typescript',
    'interface User { name: string }\nconst count: number = 42;\nconst view = <span>{count}</span>;',
    'interface',
  ],
  [
    'python',
    'def greet(name):\n    message = "hello"\n    if name:\n        return ',
    'def',
  ],
  [
    'go',
    'package main\nfunc main() {\n message := "hello"\n println(message',
    'func',
  ],
] as const)(
  'highlights %s, including incomplete code',
  (language, code, keyword) => {
    expect(tokens(code, language, 'keyword')).toContain(keyword);
    expect(
      highlighters.get(language)!.highlight(code).flat().length,
    ).toBeGreaterThan(2);
  },
);
it('keeps comment contents as comments across lines and highlights recovered code afterward', () => {
  const code = '/* a comment\nreturn 123\nend */\nconst answer = 42;';
  const highlighted = highlighters.get('javascript')!.highlight(code);
  expect(highlighted[1]).toEqual([{ start: 0, end: 10, kind: 'comment' }]);
  expect(tokens(code, 'javascript', 'number')).toEqual(['42']);
});
it('recognizes multiline Python strings without highlighting keywords inside them', () => {
  const code =
    'message = """hello\ndef fake():\n    return 123\n"""\nprint(message)';
  expect(tokens(code, 'python', 'keyword')).toEqual([]);
  expect(tokens(code, 'python', 'string').join('\n')).toContain('return 123');
  expect(tokens(code, 'python', 'function')).toContain('print');
});
it('uses UTF-16 offsets matching the editor after emoji and CRLF', () => {
  const code = 'const emoji = "😀"; const answer = 42;\r\n// 日本語';
  const lines = highlighters.get('javascript')!.highlight(code);
  expect(lines[0].find((token) => token.kind === 'number')).toMatchObject({
    start: code.indexOf('42'),
    end: code.indexOf('42') + 2,
  });
  expect(tokens(code, 'javascript', 'string')).toEqual(['"😀"']);
  expect(tokens(code, 'javascript', 'comment')).toEqual(['// 日本語']);
});
it('captures TypeScript types and JSX tags', () => {
  const code = 'const count: number = 42;\nconst view = <span>{count}</span>;';
  expect(tokens(code, 'typescript', 'type')).toContain('number');
  expect(tokens(code, 'typescript', 'tag')).toEqual(['span', 'span']);
});
