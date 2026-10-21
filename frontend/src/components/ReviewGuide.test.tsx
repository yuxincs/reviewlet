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

afterEach(cleanup);

it('summarizes a finding range and supports steps with or without symbol links', () => {
  const finding: GuideFinding = {
    id: 'repeated-work',
    summary: 'Repeated computation',
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
