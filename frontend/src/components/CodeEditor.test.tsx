import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CodeEditor } from './CodeEditor';
import type { Finding } from '../types/review';

afterEach(cleanup);

it('marks every line in finding ranges and uses the highest overlapping severity', () => {
  const finding: Finding = {
    id: 'suggestion',
    title: 'Example finding',
    severity: 'low',
    category: 'Maintainability',
    lineStart: 1,
    lineEnd: 3,
    description: '',
    suggestion: '',
    suggestedCode: '',
    status: 'open',
    comments: [],
  };
  const { container } = render(
    <CodeEditor
      code={'one\ntwo\nthree\nfour\nfive'}
      language="typescript"
      findings={[
        finding,
        { ...finding, id: 'bug', severity: 'high', lineStart: 2, lineEnd: 4 },
      ]}
      onChange={() => {}}
      disabled={false}
    />,
  );
  const lines = container.querySelectorAll('.code-line');
  expect(lines[0].classList.contains('finding-line-low')).toBe(true);
  for (const index of [1, 2, 3])
    expect(lines[index].classList.contains('finding-line-high')).toBe(true);
  expect(lines[4].classList.contains('finding-line')).toBe(false);
  expect(container.querySelectorAll('.finding-line-number')).toHaveLength(4);
});

it('keeps editor elements and selection mounted while restoring scroll after an inline preview', () => {
  const code = 'before\nconst old = 1;\nafter';
  const edit = {
    startLine: 2,
    endLine: 2,
    original: 'const old = 1;',
    replacement: 'const updated = 2;\nuse(updated);',
  };
  const preview = {
    edit,
    title: 'Update a value',
    onApply: vi.fn(),
    onBack: vi.fn(),
  };
  const view = (showPreview: boolean) => (
    <CodeEditor
      code={code}
      language="typescript"
      findings={[]}
      onChange={() => {}}
      disabled={false}
      fixPreview={showPreview ? preview : undefined}
    />
  );
  const { container, rerender } = render(view(false));
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', {
    name: 'Code snippet',
  });
  const highlight = container.querySelector<HTMLElement>('.highlight-code')!;
  const gutter = container.querySelector<HTMLElement>('.line-numbers')!;
  input.setSelectionRange(8, 13);
  input.scrollTop = 40;
  input.scrollLeft = 20;
  fireEvent.scroll(input);
  rerender(view(true));
  expect(screen.getByRole('textbox', { name: 'Code snippet' })).toBe(input);
  expect(container.querySelector('.highlight-code')).toBe(highlight);
  expect(container.querySelector('.line-numbers')).toBe(gutter);
  expect(input.value).toBe(code);
  expect(input.readOnly).toBe(true);
  expect(input.selectionStart).toBe(8);
  expect(input.selectionEnd).toBe(13);
  expect(input.scrollTop).toBe(40);
  input.scrollTop = 80;
  input.scrollLeft = 50;
  fireEvent.scroll(input);
  expect(highlight.scrollTop).toBe(80);
  expect(gutter.scrollTop).toBe(80);
  expect(
    container.querySelector<HTMLElement>('.inline-fix-actions')?.style
      .transform,
  ).toBe('translateY(-80px)');
  fireEvent.keyDown(
    screen.getByRole('region', { name: 'Suggested fix preview' }),
    { key: 'Escape' },
  );
  expect(preview.onBack).toHaveBeenCalledOnce();
  rerender(view(false));
  expect(input.readOnly).toBe(false);
  expect(input.scrollTop).toBe(40);
  expect(input.scrollLeft).toBe(20);
  expect(highlight.scrollTop).toBe(40);
  expect(highlight.scrollLeft).toBe(20);
  expect(input.selectionStart).toBe(8);
  expect(input.selectionEnd).toBe(13);
  expect(container.querySelector('.fix-diff-added')).toBeNull();
});
