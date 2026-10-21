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
  expect(panel.style.top).toBe('187px');
  rerender(view(8));
  expect(panel.style.left).toBe('350px');
  expect(panel.style.top).toBe('407px');
  expect(panel.style.maxHeight).toBe('345px');
  scroll = 100;
  fireEvent.scroll(screen.getByTestId('editor').querySelector('.code-editor')!);
  await waitFor(() => expect(panel.style.top).toBe('307px'));
  width = 500;
  fireEvent(window, new Event('resize'));
  await waitFor(() =>
    expect(parseFloat(panel.style.left) + 380).toBeLessThanOrEqual(width - 16),
  );
  expect(onClose).not.toHaveBeenCalled();
});
