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

it('brings a distant fix into view and restores the explanation scroll position', () => {
  const code = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join(
    '\n',
  );
  const preview = {
    edit: {
      startLine: 5,
      endLine: 5,
      original: 'line 5',
      replacement: 'fixed line',
    },
    title: 'Early assignment',
    onApply: vi.fn(),
    onBack: vi.fn(),
  };
  const view = (enabled: boolean) => (
    <CodeEditor
      code={code}
      language="unknown"
      findings={[]}
      onChange={() => {}}
      disabled={false}
      fixPreview={enabled ? preview : undefined}
    />
  );
  const { container, rerender } = render(view(false));
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', {
    name: 'Code snippet',
  });
  Object.defineProperty(input, 'clientHeight', {
    configurable: true,
    value: 300,
  });
  input.scrollTop = 1500;
  input.scrollLeft = 80;
  rerender(view(true));
  expect(input.scrollTop).toBeLessThan(125);
  expect(input.scrollLeft).toBe(0);
  expect(container.querySelector('.highlight-code')?.scrollTop).toBe(
    input.scrollTop,
  );
  rerender(view(false));
  expect(input.scrollTop).toBe(1500);
  expect(input.scrollLeft).toBe(80);
});

it('scans during detection, then outlines only pending bug ranges while keeping code clickable', () => {
  const base: Finding = {
    id: 'pending',
    title: 'Pending bug',
    severity: 'high',
    category: 'Reliability',
    lineStart: 2,
    lineEnd: 3,
    description: '',
    suggestion: '',
    suggestedCode: '',
    status: 'open',
    comments: [],
    detailStatus: 'pending',
  };
  const open = vi.fn();
  const view = (
    phase: 'detecting' | 'detailing' | undefined,
    ready = false,
  ) => (
    <CodeEditor
      code={'one\ntwo\nthree\nfour'}
      language="typescript"
      findings={
        phase === 'detecting'
          ? []
          : [{ ...base, detailStatus: ready ? 'ready' : 'pending' }]
      }
      reviewPhase={phase}
      onChange={() => {}}
      onReviewLine={open}
      disabled={false}
    />
  );
  const { container, rerender } = render(view('detecting'));
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', {
    name: 'Code snippet',
  });
  expect(input.readOnly).toBe(true);
  expect(input.disabled).toBe(false);
  expect(container.querySelector('.review-scan')).not.toBeNull();
  expect(screen.getByText('Scanning for issues…')).toBeTruthy();
  rerender(view('detailing'));
  expect(container.querySelector('.review-scan')).toBeNull();
  expect(container.querySelectorAll('.pending-finding-range')).toHaveLength(1);
  expect(screen.getByText('Analyzing details…')).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: 'Show review for line 2' }),
  );
  expect(open).toHaveBeenCalled();
  input.scrollTop = 30;
  fireEvent.scroll(input);
  expect(
    container.querySelector<HTMLElement>('.pending-ranges-scroll')?.style
      .transform,
  ).toBe('translateY(-30px)');
  rerender(view('detailing', true));
  expect(container.querySelectorAll('.pending-finding-range')).toHaveLength(0);
  expect(
    screen.getByText('1/1 guides ready · Analyzing details…'),
  ).toBeTruthy();
  rerender(view(undefined, true));
  expect(input.readOnly).toBe(false);
});
