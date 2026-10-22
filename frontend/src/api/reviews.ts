import { streamReview } from './reviewStream';
import { reviewSnippet as requestReview, type ReviewResponse } from './client';
import { createSnippetStore } from './store';
import {
  createServerSnippetStore,
  type ServerSnippetStore,
} from './serverStore';
import { attachReview } from './reviewMapping';
import type { Review, ReviewApi, ReviewInput } from '../types/review';

async function sourceHash(code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(code),
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function reviewError(error: unknown, response?: Response): Error {
  let message = response?.ok
    ? 'The backend returned an invalid review. Try reviewing the snippet again.'
    : response
      ? 'The review service is unavailable. Check that the Go backend is running and try again.'
      : 'Could not reach the review service. Check your connection and that the Go backend is running.';
  const detail =
    isRecord(error) && isRecord(error.error) ? error.error : undefined;
  if (typeof detail?.message === 'string' && detail.message.trim())
    message = detail.message;
  const retry = response?.headers.get('Retry-After');
  if (
    (response?.status === 429 || response?.status === 503) &&
    retry &&
    /^\d+$/.test(retry)
  ) {
    message += ` Try again in ${retry} seconds.`;
  }
  const requestId = detail?.requestId ?? response?.headers.get('X-Request-ID');
  if (typeof requestId === 'string' && /^[\w-]{1,128}$/.test(requestId)) {
    message += ` (Request ID: ${requestId})`;
  }
  return Object.assign(new Error(message), {
    snippetVersion:
      typeof detail?.snippetVersion === 'number' &&
      Number.isInteger(detail.snippetVersion) &&
      detail.snippetVersion > 0
        ? detail.snippetVersion
        : undefined,
  });
}

async function reviewCode(
  input: ReviewInput,
  signal?: AbortSignal,
  snippetId?: string,
  onProgress?: (snapshot: ReviewResponse) => Promise<void>,
): Promise<ReviewResponse> {
  if (!input.code.trim())
    throw new Error('Add a code snippet before starting your review.');
  if (input.code.length > 30_000)
    throw new Error('Keep your snippet under 30,000 characters.');
  signal?.throwIfAborted();
  const hash = await sourceHash(input.code);
  const body = {
    ...(snippetId ? { snippetId } : {}),
    code: input.code,
    language: input.language,
    ...(input.context ? { context: input.context } : {}),
  };
  let identity: string | undefined;
  let previous: ReviewResponse | undefined;
  const validate = (review: ReviewResponse) => {
    if (
      !review ||
      !Array.isArray(review.findings) ||
      typeof review.summary !== 'string' ||
      !review.id ||
      !review.createdAt ||
      review.codeHash !== hash ||
      (identity && identity !== review.id)
    )
      throw new Error(
        'The review does not match the submitted code. Review the snippet again.',
      );
    const ids = new Set<string>();
    for (const finding of review.findings) {
      if (
        !isRecord(finding) ||
        typeof finding.id !== 'string' ||
        ids.has(finding.id) ||
        typeof finding.summary !== 'string' ||
        typeof finding.description !== 'string' ||
        !['critical', 'warning', 'info'].includes(finding.severity) ||
        !['bug', 'style', 'security', 'performance'].includes(
          finding.category,
        ) ||
        !Number.isInteger(finding.lineStart) ||
        !Number.isInteger(finding.lineEnd) ||
        finding.lineStart < 1 ||
        finding.lineEnd < finding.lineStart ||
        finding.lineEnd > input.code.split('\n').length ||
        !Array.isArray(finding.steps) ||
        finding.steps.some(
          (step) => !isRecord(step) || typeof step.description !== 'string',
        ) ||
        (review.phase === 'complete' && finding.detailStatus === 'pending')
      )
        throw reviewError(undefined);
      ids.add(finding.id);
    }
    if (
      previous &&
      (previous.createdAt !== review.createdAt ||
        previous.findings.length !== review.findings.length ||
        previous.findings.some((finding, index) => {
          const next = review.findings[index];
          return (
            finding.id !== next.id ||
            finding.summary !== next.summary ||
            finding.lineStart !== next.lineStart ||
            finding.lineEnd !== next.lineEnd ||
            finding.severity !== next.severity ||
            finding.category !== next.category ||
            (finding.detailStatus !== 'pending' &&
              finding.detailStatus !== next.detailStatus)
          );
        }))
    )
      throw reviewError(undefined);
    identity = review.id;
    previous = review;
  };
  if (onProgress)
    return streamReview(
      body,
      signal,
      async (snapshot) => {
        signal?.throwIfAborted();
        validate(snapshot);
        await onProgress(snapshot);
      },
      reviewError,
    );
  const result = await requestReview({ body, signal });
  signal?.throwIfAborted();
  if (!result.response?.ok || !result.data || typeof result.data === 'string')
    throw reviewError(result.error, result.response);
  const review = result.data;
  if (
    !Array.isArray(review.findings) ||
    typeof review.summary !== 'string' ||
    !review.id ||
    !review.createdAt
  ) {
    throw reviewError(undefined, result.response);
  }
  if (review.codeHash !== hash)
    throw new Error(
      'The review does not match the submitted code. Review the snippet again.',
    );
  return review;
}

export function createReviewApi(
  storage?: Storage,
  serverStore?: ServerSnippetStore,
): ReviewApi {
  const store =
    serverStore ??
    createSnippetStore(storage, {
      migrateFrom: 'reviewlet.mock-reviews.v1',
    });
  const requests = new Map<string, symbol>();
  const api: ReviewApi = {
    ...store,
    async reviewSnippet(id, input, signal, onProgress) {
      const existing = (await store.listReviews()).find(
        (snippet) => snippet.id === id,
      );
      if (!existing) throw new Error('This snippet is no longer available.');
      // Save the submitted version before waiting on the server.
      await store.saveSnippet(id, input);
      const request = Symbol();
      requests.set(id, request);
      let progressed: Review | undefined;
      try {
        const result = await reviewCode(
          input,
          signal,
          serverStore ? id : undefined,
          onProgress
            ? async (snapshot) => {
                const current = (await store.listReviews()).find(
                  (snippet) => snippet.id === id,
                );
                if (
                  signal?.aborted ||
                  requests.get(id) !== request ||
                  !current ||
                  current.code !== input.code ||
                  current.language !== input.language ||
                  current.context !== input.context
                )
                  throw new Error(
                    'The snippet changed while it was being reviewed. Review the latest code again.',
                  );
                progressed = serverStore
                  ? await serverStore.acceptReview(id, snapshot)
                  : {
                      ...attachReview(current, snapshot),
                      reviewStatus:
                        snapshot.phase === 'detailing'
                          ? 'reviewing'
                          : snapshot.findings.some(
                                (finding) => finding.detailStatus === 'failed',
                              )
                            ? 'failed'
                            : 'reviewed',
                    };
                onProgress(progressed);
              }
            : undefined,
        );
        const current = (await store.listReviews()).find(
          (snippet) => snippet.id === id,
        );
        if (
          requests.get(id) !== request ||
          !current ||
          current.code !== input.code ||
          current.language !== input.language ||
          current.context !== input.context
        ) {
          throw new Error(
            'The snippet changed while it was being reviewed. Review the latest code again.',
          );
        }
        if (progressed)
          return serverStore
            ? progressed
            : store.saveReviewRevision(progressed, input.code);
        if (serverStore) return serverStore.acceptReview(id, result);
        return store.saveReviewRevision(
          attachReview(current, result),
          input.code,
        );
      } catch (error) {
        // The error carries the saved version; no workspace re-fetch is needed.
        const current = (await store.listReviews()).find(
          (snippet) => snippet.id === id,
        );
        if (
          serverStore &&
          requests.get(id) === request &&
          current?.code === input.code &&
          current.language === input.language &&
          current.context === input.context
        )
          await serverStore.failReview(
            id,
            error instanceof Error &&
              'snippetVersion' in error &&
              typeof error.snippetVersion === 'number'
              ? error.snippetVersion
              : undefined,
          );
        throw error;
      } finally {
        if (requests.get(id) === request) requests.delete(id);
      }
    },
    async createReview(input) {
      const id = crypto.randomUUID();
      await store.saveSnippet(id, input);
      return api.reviewSnippet(id, input);
    },
  };
  return api;
}

export const reviewApi = createReviewApi(undefined, createServerSnippetStore());
