import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { CodeHighlight } from './CodeHighlight';
afterEach(cleanup);
it('combines syntax captures with exact review links and dims only unrelated text', () => {
  const { container } = render(
    <CodeHighlight
      line="db.query(value)"
      tokens={[
        { start: 0, end: 2, kind: 'variable' },
        { start: 2, end: 3, kind: 'punctuation' },
        { start: 3, end: 8, kind: 'function' },
      ]}
      ranges={[
        {
          symbol: 'db.query',
          symbolId: 'db.query',
          line: 1,
          startColumn: 1,
          endColumn: 9,
          role: 'sink',
        },
      ]}
      dimContext
    />,
  );
  expect(
    [...container.querySelectorAll('mark[data-reference="1:1:9"]')]
      .map((mark) => mark.textContent)
      .join(''),
  ).toBe('db.query');
  expect(container.querySelector('.token-function')?.textContent).toBe('query');
  expect(container.querySelector('.guide-context')?.textContent).toBe(
    '(value)',
  );
});
it('renders plain escaped text without a grammar instead of regex tokenization or HTML injection', () => {
  const { container } = render(
    <CodeHighlight line={'const text = "<img src=x onerror=alert(1)>";'} />,
  );
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('.token-keyword')).toBeNull();
  expect(container.textContent).toBe(
    'const text = "<img src=x onerror=alert(1)>";',
  );
});
