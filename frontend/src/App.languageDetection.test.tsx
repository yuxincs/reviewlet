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
      version: snippet.version + 1,
    });
    return Response.json(snippet);
  });
  apiClient.setConfig({ fetch: transport });
  render(<App api={createReviewApi(undefined, createServerSnippetStore())} />);
  await screen.findByRole('button', { name: 'Draft' });
  vi.useFakeTimers();
  return {
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
