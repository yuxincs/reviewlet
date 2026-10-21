import { beforeEach, describe, expect, it } from 'vitest';
import { createMockReviewApi } from './mock';
import { examples } from './examples';

beforeEach(() => localStorage.clear());

describe('mock review API', () => {
  it('reviews supported examples with findings that point to actual lines', async () => {
    const api = createMockReviewApi(undefined, 0);
    for (const example of Object.values(examples)) {
      const review = await api.createReview(example);
      expect(review.findings.length).toBeGreaterThan(0);
      for (const finding of review.findings) {
        expect(finding.lineStart).toBeGreaterThan(0);
        expect(finding.lineEnd).toBeLessThanOrEqual(
          example.code.split('\n').length,
        );
      }
    }
  });

  it('reviews an existing snippet in place and persists the result', async () => {
    const api = createMockReviewApi(localStorage, 0);
    const [snippet] = await api.listReviews();
    const reviewed = await api.reviewSnippet(snippet.id, examples.javascript);
    expect(reviewed.id).toBe(snippet.id);
    expect(reviewed.createdAt).toBe(snippet.createdAt);
    expect(reviewed.code).toBe(examples.javascript.code);
    expect(reviewed.findings).toHaveLength(2);
    const stored = await createMockReviewApi(localStorage, 0).listReviews();
    expect(stored).toEqual([reviewed]);
    await expect(
      api.reviewSnippet(snippet.id, { ...examples.javascript, code: ' ' }),
    ).rejects.toThrow('Add a code snippet');
    await expect(
      api.reviewSnippet('missing', examples.javascript),
    ).rejects.toThrow('no longer available');
  });

  it('does not fabricate findings when no demo pattern matches', async () => {
    const api = createMockReviewApi(undefined, 0);
    const review = await api.createReview({
      title: 'Add',
      code: 'const add = (a: number, b: number) => a + b;',
      language: 'typescript',
      context: '',
    });
    expect(review.findings).toEqual([]);
    expect(review.summary).toContain('not a guarantee');
  });

  it('persists finding statuses and discussions across adapter instances', async () => {
    const api = createMockReviewApi(localStorage, 0);
    const review = await api.createReview(examples.database);
    const finding = review.findings[0];
    await api.updateFinding(review.id, finding.id, 'accepted');
    await api.discussFinding(review.id, finding.id, 'How should I fix this?');
    const reloaded = await createMockReviewApi(localStorage, 0).listReviews();
    const saved = reloaded.find((item) => item.id === review.id)?.findings[0];
    expect(saved?.status).toBe('accepted');
    expect(saved?.comments.map((comment) => comment.author)).toEqual([
      'you',
      'reviewer',
    ]);
    expect(saved?.comments[1].body).toContain('not an AI-generated answer');
  });

  it('does not allow callers to mutate stored reviews through a response', async () => {
    const api = createMockReviewApi(undefined, 0);
    const reviews = await api.listReviews();
    reviews[0].findings[0].status = 'dismissed';
    expect((await api.listReviews())[0].findings[0].status).toBe('open');
  });

  it('rejects invalid submissions and unavailable finding IDs', async () => {
    const api = createMockReviewApi(undefined, 0);
    await expect(
      api.createReview({ ...examples.database, code: ' ' }),
    ).rejects.toThrow('Add a code snippet');
    await expect(
      api.createReview({ ...examples.database, code: 'a'.repeat(30_001) }),
    ).rejects.toThrow('30,000');
    await expect(
      api.updateFinding('missing', 'missing', 'accepted'),
    ).rejects.toThrow('no longer available');
  });

  it('persists deletion of the last snippet without reseeding the example', async () => {
    const api = createMockReviewApi(localStorage, 0);
    const [snippet] = await api.listReviews();
    await api.deleteSnippet(snippet.id);
    expect(await api.listReviews()).toEqual([]);
    expect(await createMockReviewApi(localStorage, 0).listReviews()).toEqual(
      [],
    );
  });

  it('recovers from invalid saved history', async () => {
    localStorage.setItem('reviewlet.mock-reviews.v1', '[{"id":"broken"}]');
    const reviews = await createMockReviewApi(localStorage, 0).listReviews();
    expect(reviews[0].title).toBe(examples.database.title);
    expect(reviews[0].findings).toHaveLength(3);
  });
});
