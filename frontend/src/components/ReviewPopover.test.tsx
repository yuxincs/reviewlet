import { afterEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ReviewPopover } from './ReviewPopover';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('sits below the final focused line and adapts to scrolling and available space', async () => {
  let scroll = 0;
  let width = 1000;
  let flowBottom = 0;
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      flowBottom ? new DOMRect(200, 200, 100, flowBottom - 200) : new DOMRect(),
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      if (this.dataset.testid === 'editor')
        return new DOMRect(100, 50, width, 800);
      if (this.classList.contains('code-editor'))
        return new DOMRect(100, 50, width, 768);
      const line = this.closest<HTMLElement>('[data-line]')?.dataset.line;
      if (line) {
        const top = (line === '4' ? 200 : 420) - scroll;
        if (this.tagName === 'MARK')
          return new DOMRect(line === '4' ? 300 : 450, top, 60, 25);
        return new DOMRect(140, top, 800, 25);
      }
      return new DOMRect();
    },
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(380);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
  const onClose = vi.fn();
  const view = (line: number) => (
    <div data-testid="editor">
      <div className="code-editor">
        <div className="code-line" data-line="4">
          <mark className="guide-symbol">input</mark>
        </div>
        <div className="code-line" data-line="8">
          <mark className="guide-symbol">query</mark>
        </div>
      </div>
      <svg className="data-flow-overlay">
        <path className="data-flow-track" d="M 0 0" />
      </svg>
      <ReviewPopover
        open
        anchor={{ x: 150, y: 200 }}
        focusedLine={line}
        onClose={onClose}
      >
        <div>Explanation</div>
      </ReviewPopover>
    </div>
  );
  const { rerender } = render(view(4));
  const panel = screen.getByRole('dialog', { name: 'Review guide' });
  expect(panel.style.left).toBe('200px');
  expect(panel.style.top).toBe('207px');
  rerender(view(8));
  expect(panel.style.left).toBe('350px');
  expect(panel.style.top).toBe('427px');
  expect(panel.style.maxHeight).toBe('325px');
  scroll = 100;
  fireEvent.scroll(screen.getByTestId('editor').querySelector('.code-editor')!);
  await waitFor(() => expect(panel.style.top).toBe('327px'));
  width = 500;
  fireEvent(window, new Event('resize'));
  await waitFor(() =>
    expect(parseFloat(panel.style.left) + 380).toBeLessThanOrEqual(width - 16),
  );
  flowBottom = 520;
  const path = screen.getByTestId('editor').querySelector('.data-flow-track')!;
  path.setAttribute('d', 'M 0 0 C 20 10 40 500 50 520');
  await waitFor(() =>
    expect(parseFloat(panel.style.top) + 50).toBeGreaterThanOrEqual(
      flowBottom + 32,
    ),
  );
  expect(onClose).not.toHaveBeenCalled();
});
