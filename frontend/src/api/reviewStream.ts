import { apiClient, type ReviewResponse, type ReviewRequest } from './client';

// POST SSE keeps request code in the body. It deliberately does not reconnect:
// reconnecting would start another billable review rather than resume this one.
export async function streamReview(
  body: ReviewRequest,
  signal: AbortSignal | undefined,
  onSnapshot: (snapshot: ReviewResponse) => Promise<void>,
  makeError: (error: unknown, response?: Response) => Error,
): Promise<ReviewResponse> {
  const config = apiClient.getConfig();
  const request = new Request(
    `${config.baseUrl?.replace(/\/$/, '')}/api/v1/review`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal,
    },
  );
  const response = await (config.fetch ?? globalThis.fetch)(request);
  if (!response.ok)
    throw makeError(await response.json().catch(() => undefined), response);
  if (!response.headers.get('Content-Type')?.includes('text/event-stream')) {
    const result = (await response.json()) as ReviewResponse;
    await onSnapshot(result);
    return result;
  }
  if (!response.body) throw makeError(undefined, response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let terminal = false;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      // CRLF can be split across chunks; normalize only complete frames.
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        let event = 'message';
        const data: string[] = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:'))
            data.push(line.slice(5).replace(/^ /, ''));
        }
        if (!data.length) continue;
        const payload: unknown = JSON.parse(data.join('\n'));
        if (event === 'error') throw makeError(payload, response);
        if (event !== 'progress' && event !== 'complete') continue;
        const snapshot = payload as ReviewResponse;
        if (event === 'complete' && snapshot.phase !== 'complete')
          throw makeError(undefined, response);
        await onSnapshot(snapshot);
        if (event === 'complete') {
          terminal = true;
          return snapshot;
        }
      }
      if (buffer.length > 2_000_000) throw makeError(undefined, response);
      if (done)
        throw new Error(
          'The review connection ended early. Review the snippet again.',
        );
    }
  } finally {
    // Cancel on success too; any bytes after complete are outside this run.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    if (!terminal) signal?.throwIfAborted();
  }
}
