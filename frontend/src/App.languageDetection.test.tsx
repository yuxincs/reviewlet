import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import App from './App';
import {
  apiClient,
  type SavedSnippet,
  type SaveSnippetRequest,
} from './api/client';
import { createReviewApi } from './api/reviews';
import { createServerSnippetStore } from './api/serverStore';
import { createMockReviewApi } from './api/mock';
import { LANGUAGE_DETECTION_DELAY } from './detectLanguage';

const config = apiClient.getConfig();
const python = 'def greet(name):\n    return f"Hello, {name}"';
const go = 'package main\nimport "fmt"\nfunc main() { fmt.Println("hello") }';
const id = '2681a4df-b088-4edc-9bfc-aa3981ea87a3';
const otherId = 'd1753175-8254-42e8-99d8-1ae6fc600dda';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  apiClient.setConfig(config);
});

async function openServerWorkspace() {
  const snippets: SavedSnippet[] = [id, otherId].map((id, index) => ({
    id,
    title: index ? 'Other snippet' : 'Draft',
    language: 'unknown',
    code: '',
    context: '',
    createdAt: '2026-10-22T00:00:00Z',
    updatedAt: '2026-10-22T00:00:00Z',
    version: 1,
    reviewStatus: 'draft',
  }));
  const transport = vi.fn<typeof fetch>(async (input) => {
    const request = input as Request;
    if (request.method === 'GET') return Response.json(snippets);
    const snippet = snippets.find((item) => request.url.endsWith(item.id))!;
    const body = (await request.json()) as SaveSnippetRequest;
    expect(body.expectedVersion).toBe(snippet.version);
    Object.assign(snippet, {
      title: body.title,
      code: body.code,
      language: body.language,
      context: body.context,
      languageMode: body.languageMode ?? snippet.languageMode ?? 'auto',
      version: snippet.version + 1,
    });
    return Response.json(snippet);
  });
  apiClient.setConfig({ fetch: transport });
  const view = render(
    <App api={createReviewApi(undefined, createServerSnippetStore())} />,
  );
  await screen.findByRole('button', { name: 'Draft' });
  vi.useFakeTimers();
  return {
    view,
    snippets,
    transport,
    editor: screen.getByRole('textbox', { name: 'Code snippet' }),
  };
}

it('debounces typing, saves detected metadata to the backend only when it changes, and resets empty input', async () => {
  const { snippets, transport, editor } = await openServerWorkspace();
  fireEvent.change(editor, { target: { value: python } });
  fireEvent.change(editor, { target: { value: go } });
  expect(transport).toHaveBeenCalledTimes(1); // Initial GET only.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LANGUAGE_DETECTION_DELAY);
  });
  expect(snippets[0]).toMatchObject({ language: 'go', code: go });
  expect(
    within(screen.getByRole('main', { name: 'Code editor' })).getByText('Go'),
  ).toBeTruthy();
  expect(transport).toHaveBeenCalledTimes(2);
  fireEvent.change(editor, { target: { value: go + '\n// same language' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LANGUAGE_DETECTION_DELAY);
  });
  expect(transport).toHaveBeenCalledTimes(2);
  fireEvent.change(editor, { target: { value: '' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LANGUAGE_DETECTION_DELAY);
  });
  expect(snippets[0]).toMatchObject({ language: 'unknown', code: '' });
});

it('flushes detection when switching snippets without updating the next snippet', async () => {
  const { snippets, transport, editor } = await openServerWorkspace();
  fireEvent.change(editor, { target: { value: python } });
  fireEvent.click(screen.getByRole('button', { name: 'Other snippet' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LANGUAGE_DETECTION_DELAY);
  });
  expect(snippets[0]).toMatchObject({ language: 'python', code: python });
  expect(snippets[1]).toMatchObject({ language: 'unknown', code: '' });
  expect(transport).toHaveBeenCalledTimes(2);
});

it('submits the detected language when review starts before the debounce expires', async () => {
  const api = createMockReviewApi(localStorage, 0);
  for (const snippet of await api.listReviews())
    await api.deleteSnippet(snippet.id);
  await api.saveSnippet(id, {
    title: 'Draft',
    code: '',
    language: 'unknown',
    context: '',
  });
  const review = vi.spyOn(api, 'reviewSnippet');
  render(<App api={api} />);
  await screen.findByRole('button', { name: 'Draft' });
  vi.useFakeTimers();
  const editor = screen.getByRole('textbox', { name: 'Code snippet' });
  fireEvent.change(editor, { target: { value: python } });
  fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(review).toHaveBeenCalledWith(
    id,
    expect.objectContaining({ code: python, language: 'python' }),
    expect.any(AbortSignal),
  );
});

it('persists a manual language across typing and reloads, then resumes detection with Auto', async () => {
  const { snippets, transport, editor } = await openServerWorkspace();
  const dropdown = screen.getByRole<HTMLSelectElement>('combobox', {
    name: 'Snippet language',
  });
  expect(dropdown.value).toBe('auto');
  expect(
    within(dropdown).queryByRole('option', { name: 'Unknown' }),
  ).toBeNull();
  fireEvent.change(editor, { target: { value: python } });
  fireEvent.change(dropdown, { target: { value: 'typescript' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LANGUAGE_DETECTION_DELAY);
  });
  expect(snippets[0]).toMatchObject({
    language: 'typescript',
    languageMode: 'manual',
    code: python,
  });
  expect(transport).toHaveBeenCalledTimes(2);
  fireEvent.change(editor, { target: { value: go } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LANGUAGE_DETECTION_DELAY);
  });
  expect(dropdown.value).toBe('typescript');
  expect(transport).toHaveBeenCalledTimes(2);
  fireEvent.blur(editor);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(snippets[0]).toMatchObject({
    language: 'typescript',
    languageMode: 'manual',
    code: go,
  });
  cleanup();
  vi.useRealTimers();
  render(<App api={createReviewApi(undefined, createServerSnippetStore())} />);
  await screen.findByRole('button', { name: 'Draft' });
  const restored = screen.getByRole<HTMLSelectElement>('combobox', {
    name: 'Snippet language',
  });
  expect(restored.value).toBe('typescript');
  vi.useFakeTimers();
  fireEvent.change(restored, { target: { value: 'auto' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(snippets[0]).toMatchObject({ language: 'go', languageMode: 'auto' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Code snippet' }), {
    target: { value: python },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LANGUAGE_DETECTION_DELAY);
  });
  expect(snippets[0]).toMatchObject({
    language: 'python',
    languageMode: 'auto',
  });
});

it('pulls only on startup and preserves an unsaved draft across API prop changes and elapsed time', async () => {
  const { view, editor, transport } = await openServerWorkspace();
  fireEvent.change(editor, { target: { value: 'unfinished changes' } });
  view.rerender(
    <App api={createReviewApi(undefined, createServerSnippetStore())} />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Code snippet' })
      .value,
  ).toBe('unfinished changes');
  expect(
    transport.mock.calls.filter(
      ([request]) => (request as Request).method === 'GET',
    ),
  ).toHaveLength(1);
});

it('autosaves the latest draft after five idle seconds and restarts the timer for each edit', async () => {
  const { editor, snippets, transport } = await openServerWorkspace();
  fireEvent.change(editor, { target: { value: 'first draft' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4_000);
  });
  expect(transport).toHaveBeenCalledTimes(1);
  fireEvent.change(editor, { target: { value: 'latest draft' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4_999);
  });
  expect(transport).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(snippets[0].code).toBe('latest draft');
  expect(transport).toHaveBeenCalledTimes(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });
  expect(transport).toHaveBeenCalledTimes(2);
});

it('does not duplicate an idle save after blur already saved the edit', async () => {
  const { editor, snippets, transport } = await openServerWorkspace();
  fireEvent.change(editor, { target: { value: 'draft text' } });
  fireEvent.blur(editor);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(snippets[0].code).toBe('draft text');
  expect(transport).toHaveBeenCalledTimes(2);
});

it('keeps newer editor contents when an earlier autosave finishes late', async () => {
  const { editor, snippets, transport } = await openServerWorkspace();
  let finish!: (value: Response) => void;
  let savedBody!: SaveSnippetRequest;
  transport.mockImplementationOnce(async (input) => {
    savedBody = (await (input as Request).json()) as SaveSnippetRequest;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  fireEvent.change(editor, { target: { value: 'earlier draft' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(savedBody.code).toBe('earlier draft');
  fireEvent.change(editor, { target: { value: 'newer draft' } });
  await act(async () => {
    Object.assign(snippets[0], {
      ...savedBody,
      version: snippets[0].version + 1,
    });
    finish(Response.json(snippets[0]));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect((editor as HTMLTextAreaElement).value).toBe('newer draft');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(snippets[0].code).toBe('newer draft');
  expect(transport).toHaveBeenCalledTimes(3);
  expect(
    transport.mock.calls.filter(
      ([request]) => (request as Request).method === 'GET',
    ),
  ).toHaveLength(1);
});
