import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient, reviewSnippet, type ReviewResponse } from './client';

const initialConfig = apiClient.getConfig();
afterEach(() => apiClient.setConfig(initialConfig));

describe('review HTTP client', () => {
  it('posts the snippet to the same origin and returns a typed review', async () => {
    const review: ReviewResponse = {
      id: 'review-1',
      createdAt: '2026-10-21T12:00:00Z',
      codeHash: 'a'.repeat(64),
      language: 'typescript',
      summary: 'No findings.',
      findings: [],
    };
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(review));
    apiClient.setConfig({ fetch: transport });

    const body = { code: 'const answer = 42;', language: 'typescript' };
    const result = await reviewSnippet({ body });

    expect(result.data).toEqual(review);
    const request = transport.mock.calls[0][0] as Request;
    expect(request.url).toBe(`${location.origin}/api/v1/review`);
    expect(request.method).toBe('POST');
    expect(request.headers.get('Content-Type')).toBe('application/json');
    expect(await request.json()).toEqual(body);
  });

  it('preserves structured API errors for callers', async () => {
    const error = {
      error: { code: 'invalid_request', message: 'Code is required.' },
    };
    apiClient.setConfig({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(error, { status: 400 })),
    });

    const result = await reviewSnippet({ body: { code: '' } });

    expect(result.data).toBeUndefined();
    expect(result.error).toEqual(error);
    expect(result.response?.status).toBe(400);
  });
});
