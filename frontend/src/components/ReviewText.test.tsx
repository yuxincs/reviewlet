import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ReviewText } from './ReviewText';
import { createFlowPalette, flowColor, FlowColorContext } from '../flowColors';
import type { GuideFlowNode } from '../demoReviewGuide';

afterEach(cleanup);

it('formats inline expressions with the same binding colors as editor highlights', () => {
  const node = (symbol: string, symbolId: string): GuideFlowNode => ({
    label: symbol,
    reference: {
      symbol,
      symbolId,
      line: 1,
      startColumn: 1,
      endColumn: symbol.length + 1,
      role: 'source',
    },
  });
  const query = node('query', 'local-query');
  const method = node('db.query', 'database-method');
  const nodes = [query, method, node('', 'empty')];
  const palette = createFlowPalette(nodes);
  const text =
    'Pass `query` to `db.query(query)`; `queryCount` stays neutral. `<img src=x>` is text.';
  const { container } = render(
    <FlowColorContext.Provider value={palette}>
      <ReviewText text={text} nodes={nodes} />
    </FlowColorContext.Provider>,
  );
  const snippets = container.querySelectorAll('code');
  expect(snippets).toHaveLength(4);
  expect(snippets[1].textContent).toBe('db.query(query)');
  const colors = Array.from(
    snippets[1].querySelectorAll<HTMLElement>('.flow-color'),
  ).map((span) => span.style.getPropertyValue('--flow-hue'));
  expect(colors).toEqual([
    String(flowColor(method, palette)),
    String(flowColor(query, palette)),
  ]);
  expect(colors[0]).not.toBe(colors[1]);
  expect(snippets[2].querySelector('.flow-color')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
});
