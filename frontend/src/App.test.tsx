import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import App from './App';
import { createMockReviewApi } from './api/mock';
import { examples } from './api/examples';
import { demoSnippet } from './api/demo';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openWorkspace() {
  const api = createMockReviewApi(localStorage, 0);
  render(<App api={api} />);
  await screen.findByRole('button', { name: 'Fetch a user by ID' });
  return api;
}

describe('snippet editor workspace', () => {
  it('shows just the editor with an editable title and persists edits', async () => {
    await openWorkspace();
    const main = screen.getByRole('main', { name: 'Code editor' });
    expect(within(main).getAllByRole('textbox')).toHaveLength(1);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Review snippet' })
        .disabled,
    ).toBe(false);
    expect(
      screen.queryByRole('button', { name: /Switch to .* mode/ }),
    ).toBeNull();
    expect(screen.queryByRole('article')).toBeNull();
    const title = screen.getByRole('textbox', { name: 'Snippet name' });
    fireEvent.change(title, { target: { value: 'User lookup' } });
    expect(screen.getByRole('button', { name: 'User lookup' })).toBeTruthy();
    fireEvent.blur(title);
    const editor = screen.getByRole('textbox', { name: 'Code snippet' });
    fireEvent.change(editor, { target: { value: 'const user = null;' } });
    fireEvent.blur(editor);
    const reloaded = await createMockReviewApi(localStorage, 0).listReviews();
    expect(reloaded[0].title).toBe('User lookup');
    expect(reloaded[0].code).toBe('const user = null;');
    expect(reloaded[0].findings).toEqual([]);
  });

  it('creates an empty snippet and preserves changes when switching snippets', async () => {
    await openWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'New snippet' }));
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Code snippet',
    });
    expect(editor.value).toBe('');
    const title = screen.getByRole('textbox', { name: 'Snippet name' });
    fireEvent.change(title, { target: { value: 'Calculator helper' } });
    fireEvent.change(editor, { target: { value: 'const result = 1 + 2;' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch a user by ID' }));
    expect(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Snippet name' })
        .value,
    ).toBe('Fetch a user by ID');
    fireEvent.click(screen.getByRole('button', { name: 'Calculator helper' }));
    expect(editor.value).toBe('const result = 1 + 2;');
    const reloaded = await createMockReviewApi(localStorage, 0).listReviews();
    expect(
      reloaded.find((snippet) => snippet.title === 'Calculator helper')?.code,
    ).toBe('const result = 1 + 2;');
    expect(
      reloaded.find((snippet) => snippet.title === 'Calculator helper')
        ?.language,
    ).toBe('unknown');
  });

  it('reviews the latest editor contents by button and Command+Enter without duplicating snippets', async () => {
    const api = await openWorkspace();
    const submit = vi.spyOn(api, 'reviewSnippet');
    const editor = screen.getByRole('textbox', { name: 'Code snippet' });
    const code = 'export function calculate(input) { return eval(input); }';
    fireEvent.change(editor, { target: { value: code } });
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
    const reviewingButton = await screen.findByRole('button', {
      name: 'Reviewing…',
    });
    expect(reviewingButton.getAttribute('aria-busy')).toBe('true');
    const sidebarItem = screen.getByRole('button', {
      name: examples.database.title,
    });
    expect(sidebarItem.getAttribute('aria-busy')).toBe('true');
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Review complete: 1 finding.',
      ),
    );
    expect(sidebarItem.getAttribute('aria-busy')).toBe('false');
    expect(
      screen
        .getByRole('button', { name: 'Review snippet' })
        .getAttribute('aria-busy'),
    ).toBe('false');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][1].code).toBe(code);
    const stored = await createMockReviewApi(localStorage, 0).listReviews();
    expect(stored).toHaveLength(1);
    expect(stored[0].findings).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Review snippet' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Review complete: 1 finding.',
      ),
    );
  });

  it('ignores empty code, plain Enter, composing events, and repeated shortcut keys', async () => {
    const api = await openWorkspace();
    const submit = vi.spyOn(api, 'reviewSnippet');
    fireEvent.click(screen.getByRole('button', { name: 'New snippet' }));
    const editor = screen.getByRole('textbox', { name: 'Code snippet' });
    fireEvent.change(editor, { target: { value: '   ' } });
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Review snippet' })
        .disabled,
    ).toBe(true);
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
    fireEvent.change(editor, { target: { value: 'const n = 1;' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true, repeat: true });
    fireEvent.keyDown(editor, {
      key: 'Enter',
      metaKey: true,
      isComposing: true,
    });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Review complete: 0 findings.',
      ),
    );
  });

  it('preserves code and allows retry after a failed review', async () => {
    const api = createMockReviewApi(localStorage, 0);
    const submit = vi
      .spyOn(api, 'reviewSnippet')
      .mockRejectedValueOnce(new Error('Review failed. Please retry.'));
    render(<App api={api} />);
    await screen.findByRole('button', { name: examples.database.title });
    fireEvent.click(screen.getByRole('button', { name: 'Review snippet' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Review failed',
    );
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Code snippet' })
        .value,
    ).toBe(examples.database.code);
    fireEvent.click(screen.getByRole('button', { name: 'Review snippet' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Review complete: 3 findings.',
      ),
    );
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('highlights review findings, preserves them on rename, and clears them on edits', async () => {
    await openWorkspace();
    const highlightedLines = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>('.code-line.finding-line'),
      ).map((line) => line.dataset.line);
    expect(highlightedLines()).toEqual(['4', '7', '9']);
    const title = screen.getByRole('textbox', { name: 'Snippet name' });
    fireEvent.change(title, { target: { value: 'Renamed' } });
    expect(highlightedLines()).toEqual(['4', '7', '9']);
    const editor = screen.getByRole('textbox', { name: 'Code snippet' });
    fireEvent.change(editor, { target: { value: 'eval(input);' } });
    expect(highlightedLines()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Review snippet' }));
    await waitFor(() => expect(highlightedLines()).toEqual(['1']));
    expect(editor.getAttribute('aria-describedby')).toBeTruthy();
    cleanup();
    render(<App api={createMockReviewApi(localStorage, 0)} />);
    await screen.findByRole('button', { name: 'Renamed' });
    expect(highlightedLines()).toEqual(['1']);
    fireEvent.click(screen.getByRole('button', { name: 'New snippet' }));
    expect(highlightedLines()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Renamed' }));
    expect(highlightedLines()).toEqual(['1']);
  });

  it('opens the floating guide from a finding line and dismisses it outside or with Escape', async () => {
    await openWorkspace();
    expect(screen.queryByRole('dialog', { name: 'Review guide' })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Show review for line 4' }),
    );
    const guide = screen.getByRole('dialog', { name: 'Review guide' });
    expect(
      within(guide).getByRole('heading', { name: /SQL injection risk/ }),
    ).toBeTruthy();
    expect(
      within(guide).getByRole('heading', {
        name: 'SQL injection risk',
      }),
    ).toBeTruthy();
    expect(
      within(guide).getByRole('list', { name: 'Explanation steps' }),
    ).toBeTruthy();
    expect(
      document.querySelectorAll('mark[data-symbol="userId"]'),
    ).toHaveLength(2);
    fireEvent.click(
      within(guide).getByRole('button', {
        name: /The interpolated query reaches db.query/,
      }),
    );
    const queryLine = document.querySelector('[data-line="6"]')!;
    expect(queryLine.classList.contains('guide-dimmed')).toBe(false);
    expect(
      document
        .querySelector('[data-line="3"]')
        ?.classList.contains('guide-dimmed'),
    ).toBe(true);
    expect(queryLine.querySelector('.guide-context')).toBeTruthy();
    expect(
      queryLine.querySelector('mark')?.closest('.guide-dimmed, .guide-context'),
    ).toBeNull();
    expect(
      queryLine.querySelector('mark[data-symbol="query"]')?.textContent,
    ).toBe('query');
    expect(
      Array.from(queryLine.querySelectorAll('mark[data-symbol="db.query"]'))
        .map((mark) => mark.textContent)
        .join(''),
    ).toBe('db.query');
    fireEvent.click(
      within(guide).getByRole('button', {
        name: 'Untrusted input could change the SQL statement.',
      }),
    );
    expect(document.querySelector('mark[data-symbol="db.query"]')).toBeTruthy();
    expect(
      document
        .querySelector('[data-line="4"]')
        ?.classList.contains('guide-dimmed'),
    ).toBe(false);
    expect(queryLine.classList.contains('guide-dimmed')).toBe(false);
    expect(
      screen
        .getByRole('button', { name: 'Show review for line 7' })
        .classList.contains('guide-dimmed'),
    ).toBe(true);
    fireEvent.click(
      within(guide).getByRole('button', {
        name: 'userId flows from the parameter into the SQL string.',
      }),
    );
    expect(
      document.querySelectorAll('mark[data-symbol="userId"]'),
    ).toHaveLength(2);
    fireEvent.click(
      within(guide).getByRole('heading', { name: /SQL injection risk/ }),
    );
    expect(screen.getByRole('dialog', { name: 'Review guide' })).toBeTruthy();
    expect(
      within(guide).queryByRole('navigation', { name: 'Review steps' }),
    ).toBeNull();
    expect(
      within(guide).queryByRole('heading', {
        name: /Missing user is unchecked/,
      }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Show review for line 9' }),
    );
    expect(
      within(guide).getByRole('heading', {
        name: /Missing user is unchecked/,
      }),
    ).toBeTruthy();
    expect(document.querySelectorAll('mark[data-symbol="users"]')).toHaveLength(
      2,
    );
    fireEvent.click(
      within(guide).getByRole('button', {
        name: 'users flows from the query result into the return.',
      }),
    );
    expect(screen.getByRole('dialog', { name: 'Review guide' })).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Show review for line 7' }),
    );
    expect(
      within(guide).getByRole('heading', {
        name: /User data may reach logs/,
      }),
    ).toBeTruthy();
    expect(
      within(guide).queryByRole('heading', {
        name: /SQL injection risk/,
      }),
    ).toBeNull();
    expect(
      within(guide).queryByRole('heading', {
        name: /Missing user is unchecked/,
      }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('textbox', { name: 'Snippet name' }));
    expect(screen.queryByRole('dialog', { name: 'Review guide' })).toBeNull();
    expect(document.querySelector('mark.guide-symbol')).toBeNull();
    expect(document.querySelector('.guide-dimmed, .guide-context')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Show review for line 9' }),
    );
    expect(screen.getByRole('dialog', { name: 'Review guide' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Review guide' })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Code snippet' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Show review for line 4' }),
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Code snippet' }), {
      target: { value: 'const changed = true;' },
    });
    expect(screen.queryByRole('dialog', { name: 'Review guide' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Show review for line 4' }),
    ).toBeNull();
  });

  it('navigates explanation steps with arrow keys without wrapping or changing editor cursor behavior', async () => {
    await openWorkspace();
    fireEvent.click(
      screen.getByRole('button', { name: 'Show review for line 4' }),
    );
    const panel = screen.getByRole('dialog', { name: 'Review guide' });
    const selected = () =>
      panel.querySelector('[aria-current="step"]')?.textContent;
    expect(selected()).toBeUndefined();
    expect(
      screen.queryByRole('group', { name: 'Illustrative values' }),
    ).toBeNull();
    expect(document.querySelector('mark[data-symbol="db.query"]')).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'ArrowLeft' });
    expect(selected()).toBeUndefined();
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    expect(selected()).toContain('userId flows');
    const samples = screen.getByRole('group', {
      name: 'Illustrative values',
    });
    expect(within(samples).getByText(/SELECT \* FROM users/)).toBeTruthy();
    expect(panel.contains(samples)).toBe(false);
    expect(samples.closest('.code-editor')).toBeTruthy();
    expect(selected()).toContain('userId flows');
    expect(document.querySelector('mark[data-symbol="db.query"]')).toBeNull();
    fireEvent.keyDown(panel, { key: 'ArrowLeft' });
    expect(selected()).toBeUndefined();
    expect(
      screen.queryByRole('group', { name: 'Illustrative values' }),
    ).toBeNull();
    expect(document.querySelector('mark[data-symbol="db.query"]')).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    expect(selected()).toContain('The interpolated query');
    expect(document.querySelector('mark[data-symbol="query"]')).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    expect(selected()).toContain('Untrusted input');
    expect(document.querySelector('mark[data-symbol="db.query"]')).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    expect(selected()).toContain('Bind userId');
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    expect(selected()).toContain('Bind userId');
    fireEvent.keyDown(panel, { key: 'ArrowLeft' });
    expect(selected()).toContain('Untrusted input');
    fireEvent.keyDown(panel, { key: 'ArrowRight', metaKey: true });
    fireEvent.keyDown(panel, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Code snippet' }), {
      key: 'ArrowLeft',
    });
    expect(selected()).toContain('Untrusted input');
    expect(screen.getByRole('dialog', { name: 'Review guide' })).toBeTruthy();
  });

  it('navigates findings in code order with Up/Down and starts each finding with an overview', async () => {
    await openWorkspace();
    fireEvent.click(
      screen.getByRole('button', { name: 'Show review for line 4' }),
    );
    const panel = screen.getByRole('dialog', { name: 'Review guide' });
    const selected = () =>
      panel.querySelector('[aria-current="step"]')?.textContent;
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    expect(selected()).toContain('The interpolated query');
    fireEvent.keyDown(panel, { key: 'ArrowUp' });
    expect(selected()).toContain('The interpolated query');
    const stepButton = within(panel).getByRole('button', {
      name: 'The interpolated query reaches db.query for execution.',
    });
    stepButton.focus();
    fireEvent.keyDown(stepButton, { key: 'ArrowDown' });
    expect(
      within(panel).getByRole('heading', { name: /User data may reach logs/ }),
    ).toBeTruthy();
    expect(selected()).toBeUndefined();
    expect(document.querySelector('mark[data-symbol="SELECT *"]')).toBeTruthy();
    expect(document.activeElement).toBe(panel);
    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    expect(
      within(panel).getByRole('heading', { name: /Missing user is unchecked/ }),
    ).toBeTruthy();
    expect(selected()).toBeUndefined();
    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    expect(
      within(panel).getByRole('heading', { name: /Missing user is unchecked/ }),
    ).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'ArrowUp' });
    expect(
      within(panel).getByRole('heading', { name: /User data may reach logs/ }),
    ).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'ArrowUp', metaKey: true });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Code snippet' }), {
      key: 'ArrowUp',
    });
    expect(
      within(panel).getByRole('heading', { name: /User data may reach logs/ }),
    ).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'ArrowUp' });
    expect(
      within(panel).getByRole('heading', { name: /SQL injection risk/ }),
    ).toBeTruthy();
    expect(selected()).toBeUndefined();
    expect(document.querySelector('mark[data-symbol="db.query"]')).toBeTruthy();
  });

  it('automatically shows variable-colored flows only in the editor', async () => {
    await openWorkspace();
    fireEvent.click(
      screen.getByRole('button', { name: 'Show review for line 4' }),
    );
    const panel = screen.getByRole('dialog', { name: 'Review guide' });
    expect(
      within(panel).queryByRole('button', {
        name: /Show data flow|Hide data flow/,
      }),
    ).toBeNull();
    expect(
      within(panel).queryByRole('group', { name: /data flow/ }),
    ).toBeNull();
    expect(document.querySelector('.data-flow-overlay')).toBeTruthy();
    const hue = (symbol: string) =>
      document
        .querySelector<HTMLElement>(`mark[data-symbol="${symbol}"]`)
        ?.style.getPropertyValue('--flow-hue');
    const inputHue = hue('userId');
    const queryHue = hue('query');
    expect(inputHue).toBeTruthy();
    expect(queryHue).toBeTruthy();
    expect(queryHue).not.toBe(inputHue);
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    expect(hue('query')).toBe(queryHue);
    expect(hue('db.query')).toBeTruthy();
    expect(hue('db.query')).not.toBe(queryHue);
    const difference = Math.abs(Number(hue('db.query')) - Number(queryHue));
    expect(Math.min(difference, 360 - difference)).toBeGreaterThanOrEqual(
      39.99,
    );
    const methodReference = Array.from(
      panel.querySelectorAll<HTMLElement>(
        '.guide-step-active .guide-inline-code .flow-color',
      ),
    ).find((reference) => reference.textContent === 'db.query');
    expect(methodReference?.style.getPropertyValue('--flow-hue')).toBe(
      hue('db.query'),
    );
    expect(document.querySelector('.data-flow-overlay')).toBeTruthy();
    fireEvent.click(
      within(panel).getByRole('button', {
        name: 'Bind userId as a query parameter instead of interpolating it.',
      }),
    );
    expect(hue('userId')).toBe(inputHue);
    for (let step = 0; step < 4; step++) {
      fireEvent.keyDown(panel, { key: 'ArrowLeft' });
    }
    expect(panel.querySelector('[aria-current="step"]')).toBeNull();
    expect(hue('db.query')).toBeTruthy();
    expect(
      within(panel).queryByRole('button', { name: 'Overview' }),
    ).toBeNull();
    expect(
      within(panel).queryByRole('group', { name: /data flow/ }),
    ).toBeNull();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(document.querySelector('.data-flow-overlay')).toBeNull();
  });

  it('previews a fix without changing code and returns to the same explanation', async () => {
    const api = await openWorkspace();
    fireEvent.click(
      screen.getByRole('button', { name: 'Show review for line 4' }),
    );
    const originalEditor = document.querySelector('.code-editor');
    const originalInput = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Code snippet',
    });
    const originalHighlight = document.querySelector('.highlight-code');
    const panel = screen.getByRole('dialog', { name: 'Review guide' });
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Preview fix' }));
    const preview = screen.getByRole('region', {
      name: 'Suggested fix preview',
    });
    expect(preview).toBe(originalEditor);
    expect(document.querySelector('.highlight-code')).toBe(originalHighlight);
    expect(screen.getByRole('textbox', { name: 'Code snippet' })).toBe(
      originalInput,
    );
    expect(originalInput.readOnly).toBe(true);
    expect(
      preview
        .querySelector('[data-line="3"]')
        ?.classList.contains('guide-dimmed'),
    ).toBe(true);
    expect(
      preview
        .querySelector('[data-line="4"]')
        ?.classList.contains('guide-dimmed'),
    ).toBe(false);
    expect(preview.querySelectorAll('.fix-diff-removed')).toHaveLength(3);
    expect(preview.querySelectorAll('.fix-diff-added')).toHaveLength(4);
    await waitFor(() =>
      expect(preview.querySelector('.token-keyword')).toBeTruthy(),
    );
    expect(
      document.querySelector('.data-flow-overlay, .code-samples'),
    ).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Review guide' })).toBeNull();
    expect((await api.listReviews())[0].code).toBe(examples.database.code);
    fireEvent.click(
      within(preview).getByRole('button', { name: 'Back to explanation' }),
    );
    expect(originalInput.readOnly).toBe(false);
    expect(document.querySelector('.code-editor')).toBe(originalEditor);
    const restored = screen.getByRole('dialog', { name: 'Review guide' });
    expect(
      restored.querySelector('[aria-current="step"]')?.textContent,
    ).toContain('userId flows');
    expect(document.querySelector('.data-flow-overlay')).toBeTruthy();
    fireEvent.click(
      within(restored).getByRole('button', { name: 'Preview fix' }),
    );
    fireEvent.keyDown(
      screen.getByRole('region', { name: 'Suggested fix preview' }),
      { key: 'Escape' },
    );
    expect(screen.getByRole('dialog', { name: 'Review guide' })).toBeTruthy();
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Code snippet' })
        .value,
    ).toBe(examples.database.code);
  });

  it('applies a fix, persists shifted findings, and restores the previous review on undo', async () => {
    const api = await openWorkspace();
    fireEvent.click(
      screen.getByRole('button', { name: 'Show review for line 4' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Preview fix' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply fix' }));
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Code snippet',
    });
    expect(editor.value).toContain('WHERE id = $1');
    expect(editor.value).not.toContain('const query');
    expect(
      screen.queryByRole('button', { name: 'Show review for line 4' }),
    ).toBeNull();
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeTruthy();
    const saved = (await api.listReviews())[0];
    expect(saved.code).toBe(editor.value);
    expect(
      saved.findings
        .filter((finding) => finding.status === 'open')
        .map((finding) => finding.lineStart)
        .sort((a, b) => a - b),
    ).toEqual([8, 10]);
    expect(
      saved.findings.filter((finding) => finding.status === 'accepted'),
    ).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Show review for line 8' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Show review for line 10' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(editor.value).toBe(examples.database.code);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    const restored = (await api.listReviews())[0];
    expect(restored.code).toBe(examples.database.code);
    expect(
      restored.findings.every((finding) => finding.status === 'open'),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Show review for line 4' }),
    ).toBeTruthy();
  });

  it('continues applying retained fixes after reload without submitting another review', async () => {
    const api = await openWorkspace();
    const reviewAgain = vi.spyOn(api, 'reviewSnippet');
    fireEvent.click(
      screen.getByRole('button', { name: 'Show review for line 4' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Preview fix' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply fix' }));
    await screen.findByRole('button', { name: 'Undo' });
    cleanup();
    const reloadedApi = createMockReviewApi(localStorage, 0);
    const reloadedReview = vi.spyOn(reloadedApi, 'reviewSnippet');
    render(<App api={reloadedApi} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Show review for line 8' }),
    );
    expect(
      screen.getByRole('heading', { name: 'User data may reach logs' }),
    ).toBeTruthy();
    expect(screen.queryByText(/Needs recheck/)).toBeNull();
    expect(
      document
        .querySelector('mark[data-symbol="users"]')
        ?.closest('[data-line]')
        ?.getAttribute('data-line'),
    ).toBe('4');
    fireEvent.click(screen.getByRole('button', { name: 'Preview fix' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply fix' }));
    await screen.findByRole('button', { name: 'Undo' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Show review for line 9' }),
    );
    expect(
      screen.getByRole('heading', { name: 'Missing user is unchecked' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Preview fix' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply fix' }));
    await screen.findByRole('button', { name: 'Undo' });
    expect(
      screen.queryByRole('button', { name: /Show review for line/ }),
    ).toBeNull();
    expect(screen.getByText('No remaining findings')).toBeTruthy();
    const [stored] = await reloadedApi.listReviews();
    expect(
      stored.findings.every((finding) => finding.status === 'accepted'),
    ).toBe(true);
    expect(stored.code).toContain('if (users.length === 0)');
    expect(reviewAgain).not.toHaveBeenCalled();
    expect(reloadedReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', {
          name: 'Show review for line 9',
        }).disabled,
      ).toBe(false),
    );
    expect(
      (await reloadedApi.listReviews())[0].findings.filter(
        (finding) => finding.status === 'open',
      ),
    ).toHaveLength(1);
  });

  it('restores code and findings if saving a review revision fails', async () => {
    const api = createMockReviewApi(localStorage, 0);
    render(
      <App
        api={{
          ...api,
          saveReviewRevision: () =>
            Promise.reject(new Error('Could not save fix')),
        }}
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Show review for line 4' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Preview fix' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply fix' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Code snippet' })
        .value,
    ).toBe(examples.database.code);
    expect(
      screen.getAllByRole('button', { name: /Show review for line/ }),
    ).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('previews deletion as removed code and drops Undo after subsequent edits', async () => {
    await openWorkspace();
    fireEvent.click(
      screen.getByRole('button', { name: 'Show review for line 7' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Preview fix' }));
    const preview = screen.getByRole('region', {
      name: 'Suggested fix preview',
    });
    expect(preview.querySelectorAll('.fix-diff-removed')).toHaveLength(1);
    expect(preview.querySelector('.fix-diff-added')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Apply fix' }));
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Code snippet',
    });
    expect(editor.value).not.toContain('console.log');
    await screen.findByRole('button', { name: 'Undo' });
    fireEvent.change(editor, {
      target: { value: editor.value + '\n// Another change' },
    });
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('opens findings by clicking the code surface with scroll offsets and dismisses on unmarked lines', async () => {
    await openWorkspace();
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Code snippet',
    });
    editor.style.paddingTop = '24px';
    editor.style.lineHeight = '25px';
    fireEvent.click(editor, { clientX: 160, clientY: 112 });
    expect(
      screen.getByRole('heading', { name: /SQL injection risk/ }),
    ).toBeTruthy();
    editor.scrollTop = 75;
    fireEvent.click(editor, { clientX: 160, clientY: 112 });
    expect(
      screen.getByRole('heading', { name: /User data may reach logs/ }),
    ).toBeTruthy();
    editor.scrollTop = 0;
    fireEvent.click(editor, { clientX: 160, clientY: 61 });
    expect(screen.queryByRole('dialog', { name: 'Review guide' })).toBeNull();
    editor.setSelectionRange(
      examples.database.code.indexOf('  const query'),
      examples.database.code.indexOf('  const query'),
    );
    fireEvent.keyDown(editor, { key: 'Enter', altKey: true });
    expect(screen.getByRole('dialog', { name: 'Review guide' })).toBeTruthy();
  });

  it('shows explanations for findings outside the static demo too', async () => {
    await openWorkspace();
    const editor = screen.getByRole('textbox', { name: 'Code snippet' });
    fireEvent.change(editor, { target: { value: 'eval(input);' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review snippet' }));
    const trigger = await screen.findByRole('button', {
      name: 'Show review for line 1',
    });
    fireEvent.click(trigger);
    const guide = screen.getByRole('dialog', { name: 'Review guide' });
    expect(
      within(guide).getByRole('heading', {
        name: /Untrusted input can execute code/,
      }),
    ).toBeTruthy();
    expect(
      within(guide).getByText(/eval executes its input as code/, {
        selector: 'p',
      }),
    ).toBeTruthy();
    expect(document.querySelector('mark.guide-symbol')).toBeNull();
    fireEvent.click(
      within(guide).getByRole('button', { name: 'Close review guide' }),
    );
    expect(screen.queryByRole('dialog', { name: 'Review guide' })).toBeNull();
  });

  it('normalizes empty names', async () => {
    await openWorkspace();
    const title = screen.getByRole('textbox', { name: 'Snippet name' });
    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.blur(title);
    expect(
      screen.getByRole('button', { name: 'Untitled snippet' }),
    ).toBeTruthy();
    const reloaded = await createMockReviewApi(localStorage, 0).listReviews();
    expect(reloaded[0].title).toBe('Untitled snippet');
  });

  it('keeps the sidebar usable when collapsed and remembers the preference', async () => {
    await openWorkspace();
    const sidebar = screen.getByRole('complementary', {
      name: 'Snippet library',
    });
    expect(
      within(sidebar).getByRole('link', { name: 'Reviewlet' }),
    ).toBeTruthy();
    fireEvent.click(
      within(sidebar).getByRole('button', { name: 'Collapse sidebar' }),
    );
    expect(localStorage.getItem('reviewlet.sidebar-collapsed')).toBe('true');
    fireEvent.click(
      within(sidebar).getByRole('button', { name: 'New snippet' }),
    );
    fireEvent.click(
      within(sidebar).getByRole('button', { name: 'Fetch a user by ID' }),
    );
    expect(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Snippet name' })
        .value,
    ).toBe('Fetch a user by ID');
    cleanup();
    render(<App api={createMockReviewApi(localStorage, 0)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(localStorage.getItem('reviewlet.sidebar-collapsed')).toBe('false');
  });

  it('starts collapsed on small screens and closes after selection or Escape', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    await openWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fetch a user by ID' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    fireEvent.keyDown(
      screen.getByRole('complementary', { name: 'Snippet library' }),
      { key: 'Escape' },
    );
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
  });

  it('deletes another snippet without changing the current selection', async () => {
    await openWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'New snippet' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete Fetch a user by ID' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Fetch a user by ID' }),
      ).toBeNull(),
    );
    expect(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Snippet name' })
        .value,
    ).toBe('Untitled snippet');
    const saved = await createMockReviewApi(localStorage, 0).listReviews();
    expect(saved.map((snippet) => snippet.title)).toEqual(['Untitled snippet']);
  });

  it('selects a neighbor when deleting the active snippet and handles an empty library', async () => {
    await openWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'New snippet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fetch a user by ID' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete Fetch a user by ID' }),
    );
    // Disabling or leaving the editor must not save a deleted snippet back into the library.
    fireEvent.blur(screen.getByRole('textbox', { name: 'Code snippet' }));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLInputElement>('textbox', { name: 'Snippet name' })
          .value,
      ).toBe('Untitled snippet'),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete Untitled snippet' }),
    );
    await waitFor(() =>
      expect(
        within(
          screen.getByRole('navigation', { name: 'Your snippets' }),
        ).queryAllByRole('button'),
      ).toHaveLength(0),
    );
    expect(
      screen.getByRole('heading', { name: /Smarter reviews/ }),
    ).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Code snippet' })).toBeNull();
    expect(await createMockReviewApi(localStorage, 0).listReviews()).toEqual(
      [],
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create a snippet' }));
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Code snippet' })
        .disabled,
    ).toBe(false);
  });

  it('keeps a snippet and reports an error if deletion fails', async () => {
    const api = createMockReviewApi(localStorage, 0);
    render(
      <App
        api={{
          ...api,
          deleteSnippet: () =>
            Promise.reject(new Error('Could not delete this snippet.')),
        }}
      />,
    );
    await screen.findByRole('button', { name: 'Fetch a user by ID' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete Fetch a user by ID' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Could not delete',
      ),
    );
    expect(
      screen.getByRole('button', { name: 'Fetch a user by ID' }),
    ).toBeTruthy();
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Code snippet' })
        .disabled,
    ).toBe(false);
  });

  it('welcomes an empty library after loading and creates the first snippet', async () => {
    localStorage.setItem('reviewlet.mock-reviews.v1', '[]');
    render(<App api={createMockReviewApi(localStorage, 20)} />);
    expect(
      screen.queryByRole('heading', { name: /Smarter reviews/ }),
    ).toBeNull();
    await screen.findByRole('heading', { name: /Smarter reviews/ });
    expect(screen.queryByRole('textbox', { name: 'Snippet name' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Code snippet' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create a snippet' }));
    expect(
      screen.queryByRole('heading', { name: /Smarter reviews/ }),
    ).toBeNull();
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Code snippet' })
        .value,
    ).toBe('');
    expect(
      screen.getByRole('button', { name: 'Untitled snippet' }),
    ).toBeTruthy();
  });

  it('opens an editable demo snippet and persists it in the library', async () => {
    localStorage.setItem('reviewlet.mock-reviews.v1', '[]');
    const api = createMockReviewApi(localStorage, 0);
    render(<App api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try a demo' }));
    expect(
      screen.queryByRole('heading', { name: /Smarter reviews/ }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: demoSnippet.title }),
    ).toBeTruthy();
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Code snippet',
    });
    expect(editor.value).toBe(demoSnippet.code);
    const stored = await createMockReviewApi(localStorage, 0).listReviews();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject(demoSnippet);
    fireEvent.change(editor, { target: { value: 'const demo = true;' } });
    fireEvent.blur(editor);
    expect((await api.listReviews())[0].code).toBe('const demo = true;');
  });

  it('reports a save failure without discarding the edit', async () => {
    const api = createMockReviewApi(localStorage, 0);
    render(
      <App
        api={{
          ...api,
          saveSnippet: () =>
            Promise.reject(new Error('Could not save this snippet.')),
        }}
      />,
    );
    await screen.findByRole('button', { name: 'Fetch a user by ID' });
    const title = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Snippet name',
    });
    fireEvent.change(title, { target: { value: 'Keep this edit' } });
    fireEvent.blur(title);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Could not save'),
    );
    expect(title.value).toBe('Keep this edit');
  });
});
