import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiClient, type SavedSnippet, type ReviewResponse } from './client';
import {
  createServerSnippetStore,
  fromSavedSnippet,
  toSavedReview,
} from './serverStore';
import { createReviewApi } from './reviews';
import { createSnippetStore } from './store';
import { applyReviewFix } from '../reviewRemapping';

const config = apiClient.getConfig();
const input = {
  title: 'Example',
  language: 'javascript' as const,
  code: 'return items[0].name;',
  context: 'items may be empty',
};
const result: ReviewResponse = {
  id: 'review1',
  createdAt: '2026-10-22T00:00:00Z',
  codeHash: createHash('sha256').update(input.code).digest('hex'),
  language: 'javascript',
  summary: 'Guard the empty input.',
  findings: [
    {
      id: 'f1',
      severity: 'warning',
      category: 'bug',
      summary: 'Empty input crashes',
      description: '`items[0]` can be undefined.',
      lineStart: 1,
      lineEnd: 1,
      steps: [{ description: 'Guard the first item.' }],
      fix: 'return items[0]?.name;',
      edit: {
        startLine: 1,
        endLine: 1,
        original: input.code,
        replacement: 'return items[0]?.name;',
      },
    },
  ],
};
function saved(version = 1): SavedSnippet {
  return {
    ...input,
    id: 'snippet',
    createdAt: result.createdAt,
    updatedAt: result.createdAt,
    version,
    reviewStatus: 'draft',
  };
}
function reviewed(version = 3): SavedSnippet {
  return {
    ...saved(version),
    reviewStatus: 'reviewed',
    review: {
      result: structuredClone(result),
      findingStates: {
        f1: { status: 'open', guideState: 'current', comments: [] },
      },
    },
  };
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => {
  apiClient.setConfig(config);
  vi.unstubAllGlobals();
});

it('persists a live review and dismissal through generated endpoints and restores them after reload', async () => {
  const dismissed = reviewed(5);
  dismissed.review!.findingStates.f1.status = 'dismissed';
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(saved()))
    .mockResolvedValueOnce(Response.json([saved()]))
    .mockResolvedValueOnce(Response.json(saved(2)))
    .mockResolvedValueOnce(Response.json(result))
    .mockResolvedValueOnce(Response.json([reviewed(4)]))
    .mockResolvedValueOnce(Response.json(dismissed))
    .mockResolvedValueOnce(Response.json([dismissed]));
  apiClient.setConfig({ fetch: transport });
  const api = createReviewApi(undefined, createServerSnippetStore());
  await api.saveSnippet('snippet', input);
  const review = await api.reviewSnippet('snippet', input);
  expect(review.reviewStatus).toBe('reviewed');
  const reviewRequest = transport.mock.calls[3][0] as Request;
  expect(await reviewRequest.json()).toMatchObject({
    snippetId: 'snippet',
    code: input.code,
  });
  await api.updateFinding('snippet', 'f1', 'dismissed');
  const decision = transport.mock.calls[5][0] as Request;
  expect(decision.method).toBe('PATCH');
  expect(await decision.json()).toEqual({
    reviewId: 'review1',
    status: 'dismissed',
  });
  const [restored] = await createServerSnippetStore().listReviews();
  expect(restored.findings[0].status).toBe('dismissed');
  expect(restored.analysis?.id).toBe('review1');
});

it('saves an applied fix with its decisions and version precondition, and surfaces conflicts', async () => {
  const original = reviewed(4);
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([original]));
  apiClient.setConfig({ fetch: transport });
  const store = createServerSnippetStore();
  const [review] = await store.listReviews();
  const fixed = applyReviewFix(review, 'f1')!;
  const updated: SavedSnippet = {
    ...original,
    code: fixed.code,
    version: 5,
    reviewStatus: 'stale',
    review: toSavedReview(fixed),
  };
  transport.mockResolvedValueOnce(Response.json(updated));
  const savedFix = await store.saveReviewRevision(fixed, review.code);
  expect(savedFix.findings[0].status).toBe('accepted');
  const request = transport.mock.calls[1][0] as Request;
  expect(await request.json()).toMatchObject({
    expectedVersion: 4,
    expectedCode: input.code,
    review: {
      findingStates: { f1: { status: 'accepted', guideState: 'resolved' } },
    },
  });
  transport.mockResolvedValueOnce(
    Response.json(
      { error: { message: 'The snippet changed.' } },
      { status: 409 },
    ),
  );
  await expect(store.saveReviewRevision(fixed, review.code)).rejects.toThrow(
    'The snippet changed.',
  );
});

it('imports browser snippets once without resurrecting deleted snippets', async () => {
  const local = createSnippetStore(localStorage);
  await local.saveSnippet('snippet', input);
  await local.saveReviewRevision(fromSavedSnippet(reviewed()), input.code);
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(Response.json(reviewed()))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(Response.json([]));
  apiClient.setConfig({ fetch: transport });
  const store = createServerSnippetStore(localStorage);
  const [imported] = await store.listReviews();
  expect(imported.analysis?.id).toBe('review1');
  const importRequest = transport.mock.calls[1][0] as Request;
  expect(await importRequest.json()).toMatchObject({
    initialReview: { result: { id: 'review1' } },
  });
  await store.deleteSnippet('snippet');
  expect(await createServerSnippetStore(localStorage).listReviews()).toEqual(
    [],
  );
  expect(transport).toHaveBeenCalledTimes(4);
});
