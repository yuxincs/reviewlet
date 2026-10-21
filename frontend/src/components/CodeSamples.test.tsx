import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CodeSamples } from './CodeSamples';
import type { GuideFlowNode } from '../demoReviewGuide';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('places literal examples after code and tracks scrolling and resizing', () => {
  let scroll = 0;
  let horizontal = 0;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return this.dataset.line
        ? new DOMRect(90, 150 - scroll, 700, 25)
        : new DOMRect(50, 100, 800, 400);
    },
  );
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = createRange();
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => new DOMRect(90 - horizontal, 150 - scroll, 210, 25),
    });
    return range;
  });
  const literal = '<img src=x onerror=alert(1)>';
  const source: GuideFlowNode = {
    label: 'input',
    reference: {
      symbol: 'input',
      line: 1,
      startColumn: 1,
      endColumn: 6,
      role: 'source',
    },
    sampleValue: literal,
  };
  const nodes = [
    source,
    source,
    { label: 'result', sampleValue: 'undefined' },
    { label: 'unknown' },
  ];
  const view = (values: GuideFlowNode[]) => (
    <div data-testid="editor">
      <pre>
        <span className="code-line" data-line="1">
          <span>input</span>
          {'\n'}
        </span>
      </pre>
      <CodeSamples nodes={values} />
    </div>
  );
  const { container, rerender } = render(view(nodes));
  const row = container.querySelector<HTMLElement>('[data-sample-line="1"]')!;
  expect(row.style.left).toBe('274px');
  expect(row.style.top).toBe('50px');
  expect(screen.getAllByText(literal)).toHaveLength(1);
  expect(screen.getByText('undefined')).toBeTruthy();
  expect(screen.queryByText('unknown')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
  scroll = 25;
  horizontal = 40;
  fireEvent.scroll(screen.getByTestId('editor'));
  expect(row.style.top).toBe('25px');
  expect(row.style.left).toBe('234px');
  scroll = 80;
  fireEvent(window, new Event('resize'));
  expect(row.style.visibility).toBe('hidden');
  rerender(view([{ label: 'without example' }]));
  expect(
    screen.queryByRole('group', { name: 'Illustrative values' }),
  ).toBeNull();
});
