import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import App from './App';
import { apiClient, type ReviewResponse } from './api/client';
import { createReviewApi } from './api/reviews';

const config = apiClient.getConfig();
const snippet = {
  title: 'Real backend review',
  language: 'typescript' as const,
  code: 'function first(items) {\n  return items[0].name;\n}',
  context: 'items may be empty',
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => {
  cleanup();
  apiClient.setConfig(config);
  vi.unstubAllGlobals();
});

it('submits by shortcut, highlights a backend finding, opens its explanation, and applies its fix', async () => {
  const response: ReviewResponse = {
    id: 'review-from-backend',
    createdAt: '2026-10-21T12:00:00Z',
    codeHash: createHash('sha256').update(snippet.code).digest('hex'),
    language: 'typescript',
    summary: 'Handle an empty array.',
    findings: [
      {
        id: 'backend-finding',
        summary: 'Check the first item before reading its name',
        description: 'An empty array makes `items[0]` undefined.',
        category: 'bug',
        severity: 'warning',
        lineStart: 2,
        lineEnd: 2,
        steps: [
          { description: 'The property access fails when the array is empty.' },
        ],
        fix: '  return items[0]?.name;',
        edit: {
          startLine: 2,
          endLine: 2,
          original: '  return items[0].name;',
          replacement: '  return items[0]?.name;',
        },
      },
    ],
  };
  let finish!: (value: Response) => void;
  const transport = vi.fn<typeof fetch>().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  apiClient.setConfig({ fetch: transport });
  const api = createReviewApi(localStorage);
  await api.saveSnippet('local-snippet', snippet);
  render(<App api={api} />);
  await screen.findByRole('button', { name: snippet.title });
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Code snippet' }), {
    key: 'Enter',
    metaKey: true,
  });
  await waitFor(() => expect(transport).toHaveBeenCalledOnce());
  expect(
    screen
      .getByRole('button', { name: 'Reviewing…' })
      .getAttribute('aria-busy'),
  ).toBe('true');
  finish(Response.json(response));
  await screen.findByRole('button', { name: 'Show review for line 2' });
  fireEvent.click(
    screen.getByRole('button', { name: 'Show review for line 2' }),
  );
  const guide = screen.getByRole('dialog', { name: 'Review guide' });
  expect(
    within(guide).getByRole('heading', { name: response.findings[0].summary }),
  ).toBeTruthy();
  expect(
    within(guide).getByText(response.findings[0].steps[0].description),
  ).toBeTruthy();
  fireEvent.click(within(guide).getByRole('button', { name: 'Preview fix' }));
  fireEvent.click(
    screen.getByRole('switch', { name: 'Apply fix (unfinished)' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Apply fix' }));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Code snippet' })
        .value,
    ).toContain('items[0]?.name'),
  );
  const [saved] = await createReviewApi(localStorage).listReviews();
  expect(saved.id).toBe('local-snippet');
  expect(saved.findings[0].status).toBe('accepted');
  expect(transport).toHaveBeenCalledOnce();
});

it('shows a backend error with its request ID, keeps the source, and allows retry', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: 'review_unavailable',
            message: 'Reviews are temporarily unavailable.',
            requestId: 'request-123',
          },
        },
        { status: 503 },
      ),
    )
    .mockResolvedValueOnce(
      Response.json({
        id: 'review-retry',
        createdAt: '2026-10-21T12:00:00Z',
        codeHash: createHash('sha256').update(snippet.code).digest('hex'),
        language: 'typescript',
        summary: 'No supported findings.',
        findings: [],
      }),
    );
  apiClient.setConfig({ fetch: transport });
  const api = createReviewApi(localStorage);
  await api.saveSnippet('snippet', snippet);
  render(<App api={api} />);
  await screen.findByRole('button', { name: snippet.title });
  fireEvent.click(screen.getByRole('button', { name: 'Review snippet' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Reviews are temporarily unavailable. (Request ID: request-123)',
  );
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Code snippet' })
      .value,
  ).toBe(snippet.code);
  fireEvent.click(screen.getByRole('button', { name: 'Review snippet' }));
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toBe(
      'Review complete: 0 findings.',
    ),
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(await api.listReviews()).toHaveLength(1);
});

it('dismisses a finding from the guide and keeps the decision after reloading the saved review', async () => {
  const response: ReviewResponse = {
    id: 'dismiss-review',
    createdAt: '2026-10-22T00:00:00Z',
    codeHash: createHash('sha256').update(snippet.code).digest('hex'),
    language: 'typescript',
    summary: 'Guard empty input.',
    findings: [
      {
        id: 'dismiss-finding',
        summary: 'Empty input',
        description: 'The first item can be undefined.',
        severity: 'warning',
        category: 'bug',
        lineStart: 2,
        lineEnd: 2,
        steps: [{ description: 'Check length first.' }],
        fix: '',
      },
    ],
  };
  apiClient.setConfig({
    fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json(response)),
  });
  const api = createReviewApi(localStorage);
  await api.saveSnippet('dismiss-snippet', snippet);
  await api.reviewSnippet('dismiss-snippet', snippet);
  render(<App api={api} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Show review for line 2' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss finding' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Show review for line 2' }),
    ).toBeNull(),
  );
  const [saved] = await createReviewApi(localStorage).listReviews();
  expect(saved.findings[0].status).toBe('dismissed');
});

it('shows streamed findings immediately and keeps the selected panel open as its guide becomes ready', async () => {
  const pending: ReviewResponse = {
    id: 'progressive-review',
    createdAt: '2026-10-22T00:00:00Z',
    codeHash: createHash('sha256').update(snippet.code).digest('hex'),
    language: 'typescript',
    summary: 'Found 1 finding.',
    phase: 'detailing',
    findings: [
      {
        id: 'f1',
        summary: 'Empty input',
        description: 'Preparing details.',
        severity: 'warning',
        category: 'bug',
        lineStart: 2,
        lineEnd: 2,
        steps: [{ description: 'Placeholder step.' }],
        fix: '',
        detailStatus: 'pending',
      },
    ],
  };
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      stream = controller;
    },
  });
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    );
  apiClient.setConfig({ fetch: transport });
  const api = createReviewApi(localStorage);
  await api.saveSnippet('streaming-snippet', snippet);
  const { container } = render(<App api={api} />);
  await screen.findByRole('button', { name: snippet.title });
  fireEvent.click(screen.getByRole('button', { name: 'Review snippet' }));
  await screen.findByText('Scanning for issues…');
  const send = (event: string, result: ReviewResponse) =>
    stream.enqueue(
      new TextEncoder().encode(
        `event: ${event}\ndata: ${JSON.stringify(result)}\n\n`,
      ),
    );
  send('progress', pending);
  const line = await screen.findByRole<HTMLButtonElement>('button', {
    name: 'Show review for line 2',
  });
  expect(line.disabled).toBe(false);
  expect(container.querySelectorAll('.pending-finding-range')).toHaveLength(1);
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Code snippet' })
      .readOnly,
  ).toBe(true);
  fireEvent.click(line);
  const guide = screen.getByRole('dialog', { name: 'Review guide' });
  expect(within(guide).getByText('Analyzing details…')).toBeTruthy();
  expect(within(guide).queryByText('Placeholder step.')).toBeNull();
  const ready: ReviewResponse = {
    ...pending,
    findings: [
      {
        ...pending.findings[0],
        detailStatus: 'ready',
        description: 'The first item is undefined for an empty array.',
        steps: [
          { description: 'Guard the first item before reading its name.' },
        ],
      },
    ],
  };
  send('progress', ready);
  await within(guide).findByText(
    'Guard the first item before reading its name.',
  );
  expect(container.querySelectorAll('.pending-finding-range')).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Reviewing…' })).toBeTruthy();
  expect(
    within(guide).queryByRole('button', { name: 'Dismiss finding' }),
  ).toBeNull();
  send('complete', { ...ready, phase: 'complete' });
  await screen.findByRole('button', { name: 'Review snippet' });
  expect(
    within(guide).getByRole('button', { name: 'Dismiss finding' }),
  ).toBeTruthy();
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Code snippet' })
      .readOnly,
  ).toBe(false);
  expect(
    (await createReviewApi(localStorage).listReviews())[0].guideFindings?.[0]
      .detailStatus,
  ).toBe('ready');
});
