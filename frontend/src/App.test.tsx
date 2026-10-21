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
