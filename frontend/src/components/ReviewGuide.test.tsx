import { afterEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { ReviewGuide } from './ReviewGuide';
import type { GuideFinding } from '../demoReviewGuide';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('summarizes a finding range and supports steps with or without symbol links', () => {
  const finding: GuideFinding = {
    id: 'repeated-work',
    summary: 'Repeated computation',
    description:
      'The same value is recalculated on every iteration, adding unnecessary work.',
    severity: 'warning',
    category: 'performance',
    lineStart: 2,
    lineEnd: 5,
    steps: [
      { description: 'The loop repeats the same calculation.' },
      {
        description: 'Move the invariant value outside the loop.',
        links: [
          {
            line: 3,
            startColumn: 1,
            endColumn: 6,
            symbol: 'value',
            role: 'transform',
          },
        ],
      },
    ],
    fix: 'const value = calculate();',
  };
  const onStep = vi.fn();
  const onLine = vi.fn();
  render(
    <ReviewGuide
      finding={finding}
      activeStep={0}
      isDemo={false}
      onStep={onStep}
      onLine={onLine}
      onClose={() => {}}
    />,
  );
  expect(
    screen.getByRole('heading', {
      name: 'warning · performance · Repeated computation',
    }),
  ).toBeTruthy();
  const steps = within(
    screen.getByRole('list', { name: 'Explanation steps' }),
  ).getAllByRole('listitem');
  expect(steps).toHaveLength(2);
  expect(within(steps[0]).getAllByRole('button')).toHaveLength(1);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Show value on line 3 (transform), step 2',
    }),
  );
  expect(onStep).toHaveBeenCalledWith(1);
  expect(onLine).toHaveBeenCalledWith(3);
});

it('aligns each selected step to the top, including when it was already visible', () => {
  const finding: GuideFinding = {
    id: 'example',
    summary: 'Example issue',
    description: 'A short explanation of the issue.',
    severity: 'info',
    category: 'style',
    lineStart: 1,
    lineEnd: 1,
    steps: [
      { description: 'First explanation.' },
      { description: 'Second explanation.' },
    ],
    fix: '// Suggested code',
  };
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('guide-content') ? 400 : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(50);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains('guide-content'))
        return new DOMRect(0, 100, 480, 400);
      if (this.parentElement?.classList.contains('guide-explanation-steps')) {
        const index = Array.from(this.parentElement.children).indexOf(this);
        const scroll = this.closest('.guide-content')!.scrollTop;
        return new DOMRect(0, 170 + index * 80 - scroll, 440, 50);
      }
      return new DOMRect();
    },
  );
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    paddingTop: '22px',
  } as CSSStyleDeclaration);
  const view = (index: number) => (
    <ReviewGuide
      finding={finding}
      activeStep={index}
      isDemo={false}
      onStep={() => {}}
      onLine={() => {}}
      onClose={() => {}}
    />
  );
  const { container, rerender } = render(view(0));
  const scrollArea = container.querySelector<HTMLElement>('.guide-content')!;
  expect(scrollArea.scrollTop).toBe(48);
  rerender(view(1));
  expect(scrollArea.scrollTop).toBe(128);
  expect(scrollArea.style.paddingBottom).toBe('328px');
  rerender(view(0));
  expect(scrollArea.scrollTop).toBe(48);
  rerender(view(-1));
  expect(scrollArea.scrollTop).toBe(0);
  expect(scrollArea.style.paddingBottom).toBe('');
  expect(
    container.querySelector('button[aria-pressed="true"]')?.textContent,
  ).toBe('Overview');
});
