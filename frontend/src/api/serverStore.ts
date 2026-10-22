import {
  listSnippets,
  saveSnippet,
  deleteSnippet,
  saveReviewState,
  updateFindingDecision,
} from './generated/sdk.gen';
import type { SavedSnippet, SavedReview, ReviewResponse } from './client';
import type { GuideFinding, GuideRange } from '../types/guide';
import type { Review, ReviewApi } from '../types/review';
import { attachReview } from './reviewMapping';
import { createSnippetStore } from './store';

type SnippetStore = Omit<ReviewApi, 'createReview' | 'reviewSnippet'>;
export interface ServerSnippetStore extends SnippetStore {
  acceptReview(id: string, result: ReviewResponse): Promise<Review>;
  failReview(id: string, version?: number): Promise<void>;
}

export function fromSavedSnippet(snippet: SavedSnippet): Review {
  const base: Review = {
    id: snippet.id,
    title: snippet.title,
    language: snippet.language,
    languageMode: snippet.languageMode ?? 'auto',
    code: snippet.code,
    context: snippet.context,
    createdAt: snippet.createdAt,
    summary: '',
    findings: [],
    reviewStatus: snippet.reviewStatus,
  };
  if (!snippet.review) return base;
  const review = attachReview(base, snippet.review.result);

  for (const finding of review.findings) {
    const state = snippet.review.findingStates[finding.id];
    if (!state) continue;
    finding.status = state.status;
    finding.needsRecheck = state.guideState === 'needs-recheck';
    finding.comments = state.comments;
  }
  for (const guide of review.guideFindings ?? [])
    guide.state =
      snippet.review.findingStates[guide.id]?.guideState ?? 'current';
  return review;
}

function sourceReference(reference: GuideRange) {
  return {
    symbolId: reference.symbolId ?? reference.symbol,
    symbol: reference.symbol,
    line: reference.line,
    startColumn: reference.startColumn,
    endColumn: reference.endColumn,
    role: reference.role,
  };
}
function wireFinding(
  finding: GuideFinding,
): ReviewResponse['findings'][number] {
  return {
    id: finding.id,
    summary: finding.summary,
    description: finding.description,
    severity: finding.severity,
    category: finding.category,
    lineStart: finding.lineStart,
    lineEnd: finding.lineEnd,
    fix: finding.fix,
    ...(finding.detailStatus ? { detailStatus: finding.detailStatus } : {}),
    ...(finding.detailError ? { detailError: finding.detailError } : {}),
    ...(finding.edit ? { edit: finding.edit } : {}),
    steps: finding.steps.map((step) => ({
      description: step.description,
      ...(step.links ? { links: step.links.map(sourceReference) } : {}),
      ...(step.flow
        ? {
            flow: {
              kind: step.flow.kind,
              ...(step.flow.connections
                ? { connections: step.flow.connections }
                : {}),
              nodes: step.flow.nodes.map((node) => ({
                label: node.label,
                ...(node.reference
                  ? { reference: sourceReference(node.reference) }
                  : {}),
                ...(node.sampleValue !== undefined
                  ? { sampleValue: node.sampleValue }
                  : {}),
              })),
            },
          }
        : {}),
    })),
  };
}
export function toSavedReview(review: Review): SavedReview {
  if (!review.analysis || !review.guideFindings)
    throw new Error('This snippet has no saved backend review.');
  return {
    result: {
      ...review.analysis,
      summary: review.summary,
      findings: review.guideFindings.map(wireFinding),
    },
    findingStates: Object.fromEntries(
      review.findings.map((finding) => [
        finding.id,
        {
          status: finding.status,
          guideState:
            review.guideFindings?.find((guide) => guide.id === finding.id)
              ?.state ?? 'current',
          comments: finding.comments,
        },
      ]),
    ),
  };
}

function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response?: Response;
}): T {
  if (!result.response?.ok || result.data === undefined) {
    const body = result.error as { error?: { message?: string } } | undefined;
    throw new Error(
      body?.error?.message ??
        'Could not save the workspace. Check that the backend is running.',
    );
  }
  return result.data;
}

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function createServerSnippetStore(
  storage = browserStorage(),
): ServerSnippetStore {
  const cache = new Map<string, SavedSnippet>();
  let migrated = false;
  let loaded = false;
  // Preserve the order of blur saves, review submission, fix application and deletion.
  let pending: Promise<unknown> = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = pending.then(operation);
    pending = next.catch(() => undefined);
    return next;
  }
  function remember(snippet: SavedSnippet): Review {
    cache.set(snippet.id, snippet);
    return fromSavedSnippet(structuredClone(snippet));
  }
  return {
    listReviews: () =>
      enqueue(async () => {
        if (loaded)
          return [...cache.values()].map((snippet) =>
            fromSavedSnippet(structuredClone(snippet)),
          );
        const snippets = unwrap(await listSnippets());
        if (!migrated) {
          const marker = 'reviewlet.sqlite-migrated.v1';
          let alreadyMigrated = false;
          try {
            alreadyMigrated = storage?.getItem(marker) === 'true';
          } catch {
            /* Storage is optional. */
          }
          if (!alreadyMigrated && storage) {
            const legacy = await createSnippetStore(storage, {
              migrateFrom: 'reviewlet.mock-reviews.v1',
            }).listReviews();
            for (const snippet of legacy) {
              if (snippets.some((saved) => saved.id === snippet.id)) continue;
              const imported = unwrap(
                await saveSnippet({
                  path: { id: snippet.id },
                  body: {
                    title: snippet.title,
                    initialCreatedAt: snippet.createdAt,
                    code: snippet.code,
                    language: snippet.language,
                    ...(snippet.languageMode
                      ? { languageMode: snippet.languageMode }
                      : {}),
                    context: snippet.context,
                    ...(snippet.analysis && snippet.guideFindings
                      ? { initialReview: toSavedReview(snippet) }
                      : {}),
                  },
                }),
              );
              snippets.push(imported);
            }
            try {
              storage.setItem(marker, 'true');
            } catch {
              /* Existing server IDs prevent duplicate imports. */
            }
          }
          migrated = true;
        }
        cache.clear();
        const reviews = snippets.map((snippet) => {
          // A POST stream cannot be resumed after reload. The backend cancels
          // the old run; keep any completed guides visible in this session.
          if (snippet.reviewStatus === 'reviewing' && snippet.review) {
            snippet.reviewStatus = 'failed';
            snippet.review.result.phase = 'complete';
            for (const finding of snippet.review.result.findings)
              if (finding.detailStatus === 'pending') {
                finding.detailStatus = 'failed';
                finding.detailError =
                  'The review session was interrupted. Review again to finish this guide.';
              }
          }
          return remember(snippet);
        });
        loaded = true;
        return reviews;
      }),
    acceptReview: (id, result) =>
      enqueue(async () => {
        const known = cache.get(id);
        if (!known) throw new Error('This snippet is no longer available.');
        if (!result.snippetVersion)
          throw new Error(
            'The backend did not return the saved snippet version. Restart the backend and reload.',
          );
        if (result.snippetVersion <= known.version)
          throw new Error('The snippet changed while it was being reviewed.');
        return Promise.resolve(
          remember({
            ...known,
            version: result.snippetVersion,
            reviewStatus:
              result.phase === 'detailing'
                ? 'reviewing'
                : result.findings.some(
                      (finding) => finding.detailStatus === 'failed',
                    )
                  ? 'failed'
                  : 'reviewed',
            updatedAt: result.createdAt,
            review: {
              result,
              findingStates: Object.fromEntries(
                result.findings.map((finding) => [
                  finding.id,
                  { status: 'open', guideState: 'current', comments: [] },
                ]),
              ),
            },
          }),
        );
      }),
    failReview: (id, version) =>
      enqueue(async () => {
        const known = cache.get(id);
        if (known && (!version || version >= known.version)) {
          const result = known.review?.result;
          if (result) {
            result.phase = 'complete';
            for (const finding of result.findings)
              if (finding.detailStatus === 'pending') {
                finding.detailStatus = 'failed';
                finding.detailError =
                  'Guide generation was interrupted. Review again to retry.';
              }
          }
          cache.set(id, {
            ...known,
            version: version ?? known.version,
            reviewStatus: 'failed',
          });
        }
        return Promise.resolve();
      }),
    saveSnippet: (id, input) =>
      enqueue(async () => {
        const known = cache.get(id);
        return remember(
          unwrap(
            await saveSnippet({
              path: { id },
              body: {
                title: input.title,
                code: input.code,
                context: input.context,
                language: input.language,
                ...(input.languageMode
                  ? { languageMode: input.languageMode }
                  : {}),
                ...(known ? { expectedVersion: known.version } : {}),
              },
            }),
          ),
        );
      }),
    deleteSnippet: (id) =>
      enqueue(async () => {
        const result = await deleteSnippet({ path: { id } });
        if (!result.response?.ok)
          throw new Error('Could not delete the snippet.');
        cache.delete(id);
      }),
    saveReviewRevision: (review, expectedCode) =>
      enqueue(async () => {
        const known = cache.get(review.id);
        if (!known) throw new Error('This snippet is no longer available.');
        return remember(
          unwrap(
            await saveReviewState({
              path: { id: review.id },
              body: {
                expectedVersion: known.version,
                expectedCode,
                code: review.code,
                review: toSavedReview(review),
              },
            }),
          ),
        );
      }),
    updateFinding: (id, findingId, status) =>
      enqueue(async () => {
        const reviewId = cache.get(id)?.review?.result.id;
        if (!reviewId) throw new Error('This snippet has no saved review.');
        return remember(
          unwrap(
            await updateFindingDecision({
              path: { id, findingId },
              body: { reviewId, status },
            }),
          ),
        );
      }),
    discussFinding: (id, findingId, message) =>
      enqueue(async () => {
        const known = cache.get(id);
        if (!known) throw new Error('This snippet is no longer available.');
        const body = message.trim();
        if (!body || body.length > 2000)
          throw new Error('Write a message between 1 and 2,000 characters.');
        const review = fromSavedSnippet(known);
        const finding = review.findings.find((item) => item.id === findingId);
        if (!finding) throw new Error('This finding is no longer available.');
        finding.comments.push({
          id: crypto.randomUUID(),
          author: 'you',
          body,
          createdAt: new Date().toISOString(),
        });
        return remember(
          unwrap(
            await saveReviewState({
              path: { id },
              body: {
                expectedVersion: known.version,
                expectedCode: known.code,
                code: known.code,
                review: toSavedReview(review),
              },
            }),
          ),
        );
      }),
  };
}
