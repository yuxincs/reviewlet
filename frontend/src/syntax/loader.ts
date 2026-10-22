import { Parser, Language } from 'web-tree-sitter';
import runtimeUrl from 'web-tree-sitter/web-tree-sitter.wasm?url';
import javascriptUrl from '@vscode/tree-sitter-wasm/wasm/tree-sitter-javascript.wasm?url';
import typescriptUrl from '@vscode/tree-sitter-wasm/wasm/tree-sitter-tsx.wasm?url';
import pythonUrl from '@vscode/tree-sitter-wasm/wasm/tree-sitter-python.wasm?url';
import goUrl from '@vscode/tree-sitter-wasm/wasm/tree-sitter-go.wasm?url';
import rustUrl from '@vscode/tree-sitter-wasm/wasm/tree-sitter-rust.wasm?url';
import javaUrl from '@vscode/tree-sitter-wasm/wasm/tree-sitter-java.wasm?url';
import { SyntaxHighlighter } from './engine';
import type { ParsedLanguage } from './queries';

const assets: Record<ParsedLanguage, string> = {
  javascript: javascriptUrl,
  typescript: typescriptUrl,
  python: pythonUrl,
  go: goUrl,
  rust: rustUrl,
  java: javaUrl,
};
const loaded = new Map<ParsedLanguage, Promise<SyntaxHighlighter>>();
let initialization: Promise<void> | undefined;
async function bytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load a syntax grammar.');
  return new Uint8Array(await response.arrayBuffer());
}
function initialize() {
  initialization ??= bytes(runtimeUrl)
    .then((wasmBinary) => Parser.init({ wasmBinary }))
    .catch((error: unknown) => {
      initialization = undefined;
      throw error;
    });
  return initialization;
}
export function loadHighlighter(
  language: ParsedLanguage,
): Promise<SyntaxHighlighter> {
  let promise = loaded.get(language);
  if (!promise) {
    promise = initialize()
      .then(
        async () =>
          new SyntaxHighlighter(
            language,
            await Language.load(await bytes(assets[language])),
          ),
      )
      .catch((error: unknown) => {
        loaded.delete(language);
        throw error;
      });
    loaded.set(language, promise);
  }
  return promise;
}
