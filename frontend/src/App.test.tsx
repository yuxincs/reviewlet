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
        'Demo review complete: 1 finding.',
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
        'Demo review complete: 1 finding.',
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
        'Demo review complete: 0 findings.',
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
        'Demo review complete: 3 findings.',
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
        name: 'critical · security · SQL injection risk',
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
        name: 'Show users on line 9 (sink), step 1',
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
    expect(selected()).toContain('userId flows');
    fireEvent.keyDown(panel, { key: 'ArrowLeft' });
    expect(selected()).toContain('userId flows');
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

  it('navigates findings in code order with Up/Down and starts each finding at its first step', async () => {
    await openWorkspace();
    fireEvent.click(
      screen.getByRole('button', { name: 'Show review for line 4' }),
    );
    const panel = screen.getByRole('dialog', { name: 'Review guide' });
    const selected = () =>
      panel.querySelector('[aria-current="step"]')?.textContent;
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
    expect(selected()).toContain('The full users result');
    expect(document.activeElement).toBe(panel);
    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    expect(
      within(panel).getByRole('heading', { name: /Missing user is unchecked/ }),
    ).toBeTruthy();
    expect(selected()).toContain('users flows');
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
    expect(selected()).toContain('userId flows');
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
    expect(hue('query')).toBe(queryHue);
    expect(hue('db.query')).toBeTruthy();
    expect(hue('db.query')).not.toBe(queryHue);
    const difference = Math.abs(Number(hue('db.query')) - Number(queryHue));
    expect(Math.min(difference, 360 - difference)).toBeGreaterThanOrEqual(
      39.99,
    );
    const methodLink = within(panel).getByRole('button', {
      name: 'Show db.query on line 6 (sink), step 2',
    });
    expect(methodLink.style.getPropertyValue('--flow-hue')).toBe(
      hue('db.query'),
    );
    expect(document.querySelector('.data-flow-overlay')).toBeTruthy();
    fireEvent.click(
      within(panel).getByRole('button', {
        name: 'Bind userId as a query parameter instead of interpolating it.',
      }),
    );
    expect(hue('userId')).toBe(inputHue);
    expect(
      within(panel).queryByRole('group', { name: /data flow/ }),
    ).toBeNull();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(document.querySelector('.data-flow-overlay')).toBeNull();
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
      within(guide).getByText(/eval executes its input as code/),
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
      screen.getByRole('button', { name: examples.database.title }),
    ).toBeTruthy();
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Code snippet',
    });
    expect(editor.value).toBe(examples.database.code);
    const stored = await createMockReviewApi(localStorage, 0).listReviews();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject(examples.database);
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
