import { readFile } from 'node:fs/promises';
import { beforeEach, vi } from 'vitest';

// Serve the real bundled WASM assets to browser-component tests without a server.
const originalFetch = globalThis.fetch;
const assets: Record<string, string> = {
  'web-tree-sitter.wasm': `${process.cwd()}/node_modules/web-tree-sitter/web-tree-sitter.wasm`,
  ...Object.fromEntries(
    ['javascript', 'tsx', 'python', 'go', 'rust', 'java'].map((name) => [
      `tree-sitter-${name}.wasm`,
      `${process.cwd()}/node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter-${name}.wasm`,
    ]),
  ),
};
beforeEach(() => {
  vi.stubGlobal('fetch', (async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const name =
      new URL(url, 'http://localhost').pathname.split('/').at(-1) ?? '';
    if (assets[name])
      return new Response(Uint8Array.from(await readFile(assets[name])), {
        headers: { 'Content-Type': 'application/wasm' },
      });
    return originalFetch(input, init);
  }) satisfies typeof fetch);
});
