import { afterEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { SnippetSidebar } from './SnippetSidebar';
import type { Review } from '../types/review';

afterEach(cleanup);
const snippets: Review[] = [
  { id: 'a', title: 'Go draft', language: 'go', reviewStatus: 'draft' },
  { id: 'b', title: 'Go reviewed', language: 'go', reviewStatus: 'reviewed' },
  {
    id: 'c',
    title: 'Python reviewed',
    language: 'python',
    reviewStatus: 'reviewed',
  },
].map(
  (item) =>
    ({
      code: '',
      context: '',
      summary: '',
      findings: [],
      createdAt: '2026-10-21T12:00:00Z',
      ...item,
    }) as Review,
);

it('combines filters and clears them without selecting another snippet', () => {
  const onSelect = vi.fn();
  render(
    <SnippetSidebar
      reviews={snippets}
      activeId="a"
      collapsed={false}
      busy={false}
      loading={false}
      onSelect={onSelect}
      onNew={vi.fn()}
      onDelete={vi.fn()}
      onCollapse={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
  const draft = screen.getByRole('button', { name: 'Go draft' });
  expect(within(draft).getByText('Go · Unreviewed')).toBeTruthy();
  expect(
    within(screen.getByRole('button', { name: 'Go reviewed' })).getByText(
      'Go · Reviewed',
    ),
  ).toBeTruthy();
  const time = draft.querySelector('time')!;
  expect(time.dateTime).toBe(snippets[0].createdAt);
  expect(time.textContent).toBe(
    new Date(snippets[0].createdAt).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }),
  );
  fireEvent.change(screen.getByLabelText('Filter by language'), {
    target: { value: 'go' },
  });
  fireEvent.change(screen.getByLabelText('Filter by review status'), {
    target: { value: 'reviewed' },
  });
  expect(screen.queryByRole('button', { name: 'Go draft' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Go reviewed' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Python reviewed' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Filter by review status'), {
    target: { value: 'failed' },
  });
  expect(screen.getByText('No snippets match your filters.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(
    screen
      .getByRole('button', { name: 'Go draft' })
      .getAttribute('aria-current'),
  ).toBe('page');
  expect(screen.getByRole('button', { name: 'Python reviewed' })).toBeTruthy();
  expect(onSelect).not.toHaveBeenCalled();
});

it('uses the live reviewing state when filtering', () => {
  render(
    <SnippetSidebar
      reviews={snippets}
      reviewingIds={new Set(['a'])}
      collapsed={false}
      busy={false}
      loading={false}
      onSelect={vi.fn()}
      onNew={vi.fn()}
      onDelete={vi.fn()}
      onCollapse={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
  expect(
    within(screen.getByRole('button', { name: 'Go draft' })).getByText(
      'Go · Reviewing',
    ),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Filter by review status'), {
    target: { value: 'reviewing' },
  });
  expect(
    screen.getByRole('button', { name: 'Go draft' }).getAttribute('aria-busy'),
  ).toBe('true');
  expect(screen.queryByRole('button', { name: 'Go reviewed' })).toBeNull();
});
