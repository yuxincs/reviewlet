import { expect, it } from 'vitest';
import { flowColor, createFlowPalette } from './flowColors';
import type { GuideFlowNode } from './demoReviewGuide';

const node = (
  symbol: string,
  line: number,
  symbolId?: string,
): GuideFlowNode => ({
  label: 'a display label',
  reference: {
    symbol,
    symbolId,
    line,
    startColumn: 1,
    endColumn: symbol.length + 1,
    role: 'source',
  },
});
it('generates stable colors for arbitrary variable identities across lines and labels', () => {
  const names = [
    'payload',
    'sanitizedPayload',
    'response',
    'balance',
    'accountTotal',
  ];
  expect(new Set(names.map((name) => flowColor(node(name, 1)))).size).toBe(
    names.length,
  );
  expect(flowColor(node('payload', 1))).toBe(
    flowColor({ ...node('payload', 20), label: 'another label' }),
  );
  expect(flowColor(node('value', 1, 'outer.value'))).not.toBe(
    flowColor(node('value', 8, 'inner.value')),
  );
  expect(flowColor({ ...node('renamed', 4), flowKey: 'same-flow' })).not.toBe(
    flowColor({ ...node('result', 5), flowKey: 'same-flow' }),
  );
});

it('separates arbitrary symbols, including a method and its argument, across an entire review', () => {
  const nodes = ['db.query', 'query', 'payload', 'result', 'console.log'].map(
    (symbol) => node(symbol, 1),
  );
  const palette = createFlowPalette(nodes);
  for (const first of nodes)
    for (const second of nodes) {
      if (first === second) continue;
      const difference = Math.abs(
        flowColor(first, palette) - flowColor(second, palette),
      );
      expect(Math.min(difference, 360 - difference)).toBeGreaterThanOrEqual(
        47.99,
      );
    }
  expect([...createFlowPalette([...nodes].reverse())]).toEqual([...palette]);
  expect(
    flowColor({ ...node('query', 8), flowKey: 'one-flow' }, palette),
  ).not.toBe(
    flowColor({ ...node('db.query', 8), flowKey: 'one-flow' }, palette),
  );
  expect(flowColor(node('beforeRename', 1, 'binding-id'))).toBe(
    flowColor(node('afterRename', 9, 'binding-id')),
  );
});
