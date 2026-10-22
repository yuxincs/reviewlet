// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { beforeAll, expect, it } from 'vitest';
import { Language, Parser } from 'web-tree-sitter';
import { demoSnippet, demoSnippets } from './demo';
import { detectLanguage } from '../detectLanguage';

beforeAll(async () => {
  await Parser.init({
    wasmBinary: await readFile(
      new URL(
        '../../node_modules/web-tree-sitter/web-tree-sitter.wasm',
        import.meta.url,
      ),
    ),
  });
});

it.each(demoSnippets)(
  'parses the complete $language demo and can infer its language',
  async (demo) => {
    const name = demo.language === 'typescript' ? 'tsx' : demo.language;
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
    const parser = new Parser();
    parser.setLanguage(grammar);
    const tree = parser.parse(demo.code)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(detectLanguage(demo.code)).toBe(demo.language);
    } finally {
      tree.delete();
      parser.delete();
    }
  },
);

it('provides a comprehensive newest demo with concrete input and expected output', () => {
  expect(demoSnippet.code.split('\n').length).toBeGreaterThanOrEqual(95);
  expect(demoSnippet.code.split('\n').length).toBeLessThanOrEqual(120);
  expect(demoSnippet.context).toContain('Expected output:');
  expect(demoSnippet.context).toContain('totalCents 8150');
  expect(demoSnippets[0]).toBe(demoSnippet);
});
