import { afterEach, expect, it, vi } from 'vitest';
import { apiClient, type ReviewResponse } from './client';
import { streamReview } from './reviewStream';

const original = apiClient.getConfig();
afterEach(() => {
  apiClient.setConfig(original);
});
const snapshot: ReviewResponse = {
  id: 'r1',
  createdAt: '2026-10-22T00:00:00Z',
  codeHash: 'a'.repeat(64),
  language: 'typescript',
  summary: 'Unicode → details',
  findings: [],
  phase: 'complete',
};
const input = { code: 'test' };
const makeError = () => new Error('Review failed');

it('handles split UTF-8 and CRLF frames, comments, and sequential asynchronous updates', async () => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(
    `: heartbeat\r\n\r\nevent: progress\r\ndata: ${JSON.stringify({ ...snapshot, phase: 'detailing' })}\r\n\r\nevent: complete\r\ndata: ${JSON.stringify(snapshot)}\r\n\r\n`,
  );
  const body = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  apiClient.setConfig({
    fetch: vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body, {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    ),
  });
  const phases: string[] = [];
  const result = await streamReview(
    input,
    undefined,
    async (response) => {
      await Promise.resolve();
      phases.push(response.phase!);
    },
    makeError,
  );
  expect(phases).toEqual(['detailing', 'complete']);
  expect(result).toEqual(snapshot);
});

it.each([
  [
    'truncation',
    `event: progress\ndata: ${JSON.stringify({ ...snapshot, phase: 'detailing' })}\n\n`,
    /ended early/,
  ],
  [
    'error event',
    'event: error\ndata: {"error":{"code":"review_failed"}}\n\n',
    /Review failed/,
  ],
  [
    'invalid terminal phase',
    `event: complete\ndata: ${JSON.stringify({ ...snapshot, phase: 'detailing' })}\n\n`,
    /Review failed/,
  ],
])(
  'rejects %s without silently declaring a successful review',
  async (_name, content, error) => {
    apiClient.setConfig({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(content, {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    });
    await expect(
      streamReview(input, undefined, async () => {}, makeError),
    ).rejects.toThrow(error);
  },
);
