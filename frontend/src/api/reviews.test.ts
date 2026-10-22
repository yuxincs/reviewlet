import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { apiClient, type ReviewResponse } from './client';
import { createReviewApi } from './reviews';
import { examples } from './examples';
import { createMockReviewApi } from './mock';
import { getReviewSteps } from '../demoReviewGuide';
import { applyReviewFix } from '../reviewRemapping';
import type { ReviewInput } from '../types/review';

const initialConfig = apiClient.getConfig();
const input: ReviewInput = {
  title: 'User lookup',
  language: 'javascript',
  context: 'input is untrusted',
  code: 'const userId = input;\nreturn db.query(userId);',
};

function responseFor(code = input.code): ReviewResponse {
  const source = {
    symbolId: 'lookup.userId',
    symbol: 'userId',
    line: 1,
    startColumn: 7,
    endColumn: 13,
    role: 'source' as const,
  };
  const sink = {
    symbolId: 'db.query',
    symbol: 'db.query',
    line: 2,
    startColumn: 8,
    endColumn: 16,
    role: 'sink' as const,
  };
  return {
    id: 'server-review-1',
    createdAt: '2026-10-21T12:00:00Z',
    codeHash: createHash('sha256').update(code).digest('hex'),
    language: 'javascript',
    summary: 'Use a parameterized query.',
    findings: [
      {
        id: 'server-finding-1',
        summary: 'Pass input as a query parameter',
        description: 'Untrusted `userId` reaches `db.query`.',
        severity: 'critical',
        category: 'security',
        lineStart: 2,
        lineEnd: 2,
        steps: [
          {
            description: 'Trace `userId` into `db.query`.',
            links: [source, sink],
            flow: {
              kind: 'current',
              connections: [{ from: 0, to: 1 }],
              nodes: [
                {
                  label: 'User input',
                  reference: source,
                  sampleValue: '"0 OR 1=1"',
                },
                { label: 'Query execution', reference: sink },
              ],
            },
          },
        ],
        fix: 'return db.query("SELECT * FROM users WHERE id = ?", [userId]);',
        edit: {
          startLine: 2,
          endLine: 2,
          original: 'return db.query(userId);',
          replacement:
            'return db.query("SELECT * FROM users WHERE id = ?", [userId]);',
        },
      },
    ],
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => {
  apiClient.setConfig(initialConfig);
  vi.unstubAllGlobals();
});

describe('backend review adapter', () => {
  it('submits exact source and preserves server findings, guides, metadata, and snippet identity across reloads', async () => {
    const response = responseFor();
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(response));
    apiClient.setConfig({ fetch: transport });
    const api = createReviewApi(localStorage);
    const before = await api.saveSnippet('local-snippet', input);
    const reviewed = await api.reviewSnippet(before.id, input);
    const request = transport.mock.calls[0][0] as Request;
    expect(request.url).toBe(`${location.origin}/api/v1/review`);
    expect(request.method).toBe('POST');
    expect(await request.json()).toEqual({
      code: input.code,
      language: input.language,
      context: input.context,
    });
    expect(reviewed.id).toBe(before.id);
    expect(reviewed.createdAt).toBe(before.createdAt);
    expect(reviewed.analysis).toEqual({
      id: response.id,
      createdAt: response.createdAt,
      codeHash: response.codeHash,
      language: response.language,
    });
    expect(reviewed.findings[0]).toMatchObject({
      id: response.findings[0].id,
      severity: 'high',
      category: 'Security',
      status: 'open',
      comments: [],
    });
    expect(getReviewSteps(reviewed)).toEqual(response.findings);
    expect(await createReviewApi(localStorage).listReviews()).toEqual([
      reviewed,
    ]);
    const applied = applyReviewFix(reviewed, response.findings[0].id)!;
    expect(applied.code).toContain('WHERE id = ?');
    await api.saveReviewRevision(applied, reviewed.code);
    const [saved] = await createReviewApi(localStorage).listReviews();
    expect(saved.findings[0].status).toBe('accepted');
    expect(getReviewSteps(saved)).toEqual([]);
  });

  it('accepts an empty backend review of the demo without substituting static findings', async () => {
    const response = {
      ...responseFor(examples.database.code),
      findings: [],
      summary: 'No supported findings.',
    };
    apiClient.setConfig({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json(response)),
    });
    const api = createReviewApi();
    await api.saveSnippet('demo', examples.database);
    const reviewed = await api.reviewSnippet('demo', examples.database);
    expect(reviewed.findings).toEqual([]);
    expect(reviewed.guideFindings).toEqual([]);
    expect(getReviewSteps(reviewed)).toEqual([]);
  });

  it('migrates saved snippets while clearing old mock analysis and does not reseed deleted snippets', async () => {
    const mock = createMockReviewApi(localStorage, 0);
    const [legacy] = await mock.listReviews();
    expect(legacy.findings.length).toBeGreaterThan(0);
    const api = createReviewApi(localStorage);
    const [migrated] = await api.listReviews();
    expect(migrated.id).toBe(legacy.id);
    expect(migrated.code).toBe(legacy.code);
    expect(migrated.findings).toEqual([]);
    expect(migrated.summary).toBe('');
    await api.deleteSnippet(migrated.id);
    expect(await createReviewApi(localStorage).listReviews()).toEqual([]);
  });

  it('starts with an empty workspace without making a request', async () => {
    const transport = vi.fn<typeof fetch>();
    apiClient.setConfig({ fetch: transport });
    expect(await createReviewApi(localStorage).listReviews()).toEqual([]);
    expect(transport).not.toHaveBeenCalled();
  });

  it('reports backend rate limits and request IDs without falling back to the mock', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: 'rate_limited',
            message: 'Too many review requests.',
            requestId: 'request-123',
          },
        },
        { status: 429, headers: { 'Retry-After': '7' } },
      ),
    );
    apiClient.setConfig({ fetch: transport });
    const api = createReviewApi(localStorage);
    await api.saveSnippet('snippet', input);
    await expect(api.reviewSnippet('snippet', input)).rejects.toThrow(
      'Too many review requests. Try again in 7 seconds. (Request ID: request-123)',
    );
    expect((await api.listReviews())[0].findings).toEqual([]);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('reports connection failures and allows retry using the same snippet', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(Response.json(responseFor()));
    apiClient.setConfig({ fetch: transport });
    const api = createReviewApi(localStorage);
    await api.saveSnippet('snippet', input);
    await expect(api.reviewSnippet('snippet', input)).rejects.toThrow(
      'Could not reach the review service',
    );
    expect((await api.reviewSnippet('snippet', input)).id).toBe('snippet');
    expect(await api.listReviews()).toHaveLength(1);
  });

  it('rejects mismatched source hashes without replacing existing review data', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(responseFor('different source')));
    apiClient.setConfig({ fetch: transport });
    const api = createReviewApi(localStorage);
    await api.saveSnippet('snippet', input);
    await expect(api.reviewSnippet('snippet', input)).rejects.toThrow(
      'does not match the submitted code',
    );
    expect((await api.listReviews())[0].analysis).toBeUndefined();
  });

  it.each(['edit', 'delete'] as const)(
    'discards responses after a snippet %s while the request was running',
    async (action) => {
      let resolve!: (response: Response) => void;
      const transport = vi.fn<typeof fetch>().mockImplementation(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      );
      apiClient.setConfig({ fetch: transport });
      const api = createReviewApi(localStorage);
      await api.saveSnippet('snippet', input);
      const pending = api.reviewSnippet('snippet', input);
      const rejected = expect(pending).rejects.toThrow('snippet changed');
      await waitFor(() => expect(transport).toHaveBeenCalledOnce());
      if (action === 'delete') await api.deleteSnippet('snippet');
      else
        await api.saveSnippet('snippet', {
          ...input,
          code: 'const changed = true;',
        });
      resolve(Response.json(responseFor()));
      await rejected;
      const saved = await api.listReviews();
      if (action === 'delete') expect(saved).toEqual([]);
      else {
        expect(saved[0].code).toBe('const changed = true;');
        expect(saved[0].findings).toEqual([]);
      }
    },
  );

  it('passes cancellation through to the HTTP client', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(
      (request) =>
        new Promise<Response>((_, reject) => {
          (request as Request).signal.addEventListener('abort', () =>
            reject(new DOMException('Cancelled', 'AbortError')),
          );
        }),
    );
    apiClient.setConfig({ fetch: transport });
    const api = createReviewApi(localStorage);
    await api.saveSnippet('snippet', input);
    const controller = new AbortController();
    const pending = api.reviewSnippet('snippet', input, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await waitFor(() => expect(transport).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    expect((await api.listReviews())[0].findings).toEqual([]);
  });
});
