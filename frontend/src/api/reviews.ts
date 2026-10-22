import { reviewSnippet as requestReview, type ReviewResponse } from './client';
import { createSnippetStore } from './store';
import type { Finding, Review, ReviewApi, ReviewInput } from '../types/review';

const severities: Record<
  ReviewResponse['findings'][number]['severity'],
  Finding['severity']
> = {
  critical: 'high',
  warning: 'medium',
  info: 'low',
};
const categories: Record<
  ReviewResponse['findings'][number]['category'],
  Finding['category']
> = {
  security: 'Security',
  bug: 'Reliability',
  performance: 'Reliability',
  style: 'Maintainability',
};

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
  return new Error(message);
}

async function reviewCode(
  input: ReviewInput,
  signal?: AbortSignal,
): Promise<ReviewResponse> {
  if (!input.code.trim())
    throw new Error('Add a code snippet before starting your review.');
  if (input.code.length > 30_000)
    throw new Error('Keep your snippet under 30,000 characters.');
  signal?.throwIfAborted();
  const hash = await sourceHash(input.code);
  const result = await requestReview({
    body: {
      code: input.code,
      language: input.language,
      ...(input.context ? { context: input.context } : {}),
    },
    signal,
  });
  signal?.throwIfAborted();
  if (!result.response?.ok || !result.data)
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

function attachReview(snippet: Review, result: ReviewResponse): Review {
  return {
    ...snippet,
    summary: result.summary,
    analysis: {
      id: result.id,
      createdAt: result.createdAt,
      codeHash: result.codeHash,
      language: result.language,
    },
    findings: result.findings.map((finding) => ({
      id: finding.id,
      title: finding.summary,
      severity: severities[finding.severity],
      category: categories[finding.category],
      lineStart: finding.lineStart,
      lineEnd: finding.lineEnd,
      description: finding.description,
      suggestion: finding.steps.at(-1)?.description ?? '',
      suggestedCode: finding.fix,
      status: 'open',
      comments: [],
    })),
    // Store full guides even for the demo snippet; never substitute canned guides.
    guideFindings: result.findings,
  };
}

export function createReviewApi(storage?: Storage): ReviewApi {
  const store = createSnippetStore(storage, {
    migrateFrom: 'reviewlet.mock-reviews.v1',
  });
  const requests = new Map<string, symbol>();
  const api: ReviewApi = {
    ...store,
    async reviewSnippet(id, input, signal) {
      const existing = (await store.listReviews()).find(
        (snippet) => snippet.id === id,
      );
      if (!existing) throw new Error('This snippet is no longer available.');
      // Save the submitted version before waiting on the server.
      await store.saveSnippet(id, input);
      const request = Symbol();
      requests.set(id, request);
      try {
        const result = await reviewCode(input, signal);
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
        return store.saveReviewRevision(
          attachReview(current, result),
          input.code,
        );
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

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export const reviewApi = createReviewApi(browserStorage());
