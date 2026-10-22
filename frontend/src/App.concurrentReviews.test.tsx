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
import type { ReviewInput } from './types/review';

const config = apiClient.getConfig();
const inputs: ReviewInput[] = [
  {
    title: 'Review A',
    language: 'javascript',
    code: 'const value = input;\nreturn value.name;',
    context: '',
  },
  {
    title: 'Review B',
    language: 'javascript',
    code: 'const total = price * count;\nreturn total;',
    context: '',
  },
  {
    title: 'Editable draft',
    language: 'javascript',
    code: 'const ready = true;',
    context: '',
  },
];
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => {
  cleanup();
  apiClient.setConfig(config);
  vi.unstubAllGlobals();
});

async function workspace() {
  const streams = new Map<
    string,
    ReadableStreamDefaultController<Uint8Array>
  >();
  const requests = new Map<string, Request>();
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async (request) => {
      const req = request as Request;
      const body = (await req.clone().json()) as { code: string };
      requests.set(body.code, req);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streams.set(body.code, controller);
          req.signal.addEventListener(
            'abort',
            () => controller.error(req.signal.reason),
            { once: true },
          );
        },
      });
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
  apiClient.setConfig({ fetch: transport });
  const api = createReviewApi(localStorage);
  for (const [index, input] of inputs.entries())
    await api.saveSnippet(`snippet-${index}`, input);
  const view = render(<App api={api} />);
  await screen.findByRole('button', { name: 'Review A' });
  async function start(index: number) {
    fireEvent.click(screen.getByRole('button', { name: inputs[index].title }));
    fireEvent.click(screen.getByRole('button', { name: 'Review snippet' }));
    await waitFor(() => expect(streams.has(inputs[index].code)).toBe(true));
  }
  function send(index: number, complete: boolean) {
    const input = inputs[index];
    const snapshot: ReviewResponse = {
      id: `review-${index}`,
      createdAt: '2026-10-22T00:00:00Z',
      codeHash: createHash('sha256').update(input.code).digest('hex'),
      language: input.language,
      summary: `Found an issue in ${input.title}.`,
      phase: complete ? 'complete' : 'detailing',
      findings: [
        {
          id: 'f1',
          summary: `${input.title} finding`,
          description: 'Check the value before using it.',
          severity: 'warning',
          category: 'bug',
          lineStart: 2,
          lineEnd: 2,
          steps: [{ description: `Detailed guide for ${input.title}.` }],
          fix: '',
          detailStatus: complete ? 'ready' : 'pending',
        },
      ],
    };
    const event = complete ? 'complete' : 'progress';
    streams
      .get(input.code)!
      .enqueue(
        new TextEncoder().encode(
          `event: ${event}\ndata: ${JSON.stringify(snapshot)}\n\n`,
        ),
      );
  }
  return { ...view, streams, requests, transport, start, send };
}

it('runs overlapping reviews with independent progress while allowing navigation and unrelated edits', async () => {
  const { start, send, transport } = await workspace();
  await start(0);
  await start(1);
  for (const input of inputs.slice(0, 2)) {
    expect(
      screen
        .getByRole('button', { name: input.title })
        .getAttribute('aria-busy'),
    ).toBe('true');
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: `Delete ${input.title}`,
      }).disabled,
    ).toBe(true);
  }
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Code snippet' }), {
    key: 'Enter',
    metaKey: true,
  });
  expect(transport).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Editable draft' }));
  const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
    name: 'Code snippet',
  });
  expect(editor.readOnly).toBe(false);
  fireEvent.change(editor, { target: { value: 'const editable = true;' } });
  expect(editor.value).toBe('const editable = true;');

  send(0, false);
  fireEvent.click(screen.getByRole('button', { name: 'Review A' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Show review for line 2' }),
  );
  const panel = screen.getByRole('dialog', { name: 'Review guide' });
  expect(
    within(panel).getByRole('heading', { name: 'Review A finding' }),
  ).toBeTruthy();
  expect(within(panel).getByText('Analyzing details…')).toBeTruthy();
  send(1, true);
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Review B' })
        .getAttribute('aria-busy'),
    ).toBe('false'),
  );
  expect(screen.getByRole('button', { name: 'Reviewing…' })).toBeTruthy();
  expect(
    within(panel).getByRole('heading', { name: 'Review A finding' }),
  ).toBeTruthy();
  expect(screen.queryByText('Review complete: 1 finding.')).toBeNull();
  send(0, true);
  await within(panel).findByText('Detailed guide for Review A.');
  await screen.findByRole('button', { name: 'Review snippet' });
  fireEvent.click(screen.getByRole('button', { name: 'Review B' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Show review for line 2' }),
  );
  expect(
    screen.getByRole('heading', { name: 'Review B finding' }),
  ).toBeTruthy();
  expect(
    screen.queryByRole('heading', { name: 'Review A finding' }),
  ).toBeNull();
});

it('keeps a background review failure scoped to its snippet and lets another review complete', async () => {
  const { start, send, streams } = await workspace();
  await start(0);
  await start(1);
  streams
    .get(inputs[0].code)!
    .enqueue(
      new TextEncoder().encode(
        'event: error\ndata: {"error":{"message":"Review A provider unavailable."}}\n\n',
      ),
    );
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Review A' })
        .getAttribute('aria-busy'),
    ).toBe('false'),
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'Reviewing…' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review A' }));
  expect(screen.getByRole('alert').textContent).toContain(
    'Review A provider unavailable.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Review B' }));
  expect(screen.queryByRole('alert')).toBeNull();
  send(1, true);
  await screen.findByRole('button', { name: 'Review snippet' });
  expect(
    screen.getByRole('button', { name: 'Show review for line 2' }),
  ).toBeTruthy();
});

it('cancels every in-flight review when the workspace unmounts', async () => {
  const { start, requests, unmount } = await workspace();
  await start(0);
  await start(1);
  unmount();
  expect(requests.get(inputs[0].code)!.signal.aborted).toBe(true);
  expect(requests.get(inputs[1].code)!.signal.aborted).toBe(true);
});
