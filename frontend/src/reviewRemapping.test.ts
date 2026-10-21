import { expect, it } from 'vitest';
import { createMockReviewApi } from './api/mock';
import { applyReviewFix } from './reviewRemapping';
import { getReviewSteps } from './demoReviewGuide';
import { applyCodeEdit } from './codeEdits';
import type { Review } from './types/review';

function checkReferences(review: Review) {
  const lines = review.code.split('\n');
  for (const guide of getReviewSteps(review)) {
    expect(guide.state).toBe('current');
    for (const step of guide.steps) {
      const references = [
        ...(step.links ?? []),
        ...(step.flow?.nodes.flatMap((node) =>
          node.reference ? [node.reference] : [],
        ) ?? []),
      ];
      for (const ref of references)
        expect(
          lines[ref.line - 1].slice(ref.startColumn - 1, ref.endColumn - 1),
        ).toBe(ref.symbol);
    }
    if (guide.edit)
      expect(applyCodeEdit(review.code, guide.edit)).toBeDefined();
  }
}

it('retains pending findings and relocates surviving symbols inside the replaced SQL block', async () => {
  const [review] = await createMockReviewApi(undefined, 0).listReviews();
  const [sql, empty, logging] = getReviewSteps(review);
  const updated = applyReviewFix(review, sql.id)!;
  expect(
    getReviewSteps(updated).map((guide) => [guide.id, guide.lineStart]),
  ).toEqual([
    [empty.id, 10],
    [logging.id, 8],
  ]);
  expect(
    updated.findings.find((finding) => finding.id === sql.id)?.status,
  ).toBe('accepted');
  const users = getReviewSteps(updated)[0].steps[0].flow!.nodes[1].reference!;
  expect(users).toMatchObject({ symbol: 'users', line: 4, startColumn: 9 });
  checkReferences(updated);
  expect(review.code).toContain('const query');
  expect(review.findings.every((finding) => finding.status === 'open')).toBe(
    true,
  );
});

it('supports sequential fixes in every order, shifting later fixes and preserving earlier references', async () => {
  const [original] = await createMockReviewApi(undefined, 0).listReviews();
  const ids = getReviewSteps(original).map((guide) => guide.id);
  for (const order of [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ]) {
    let review = original;
    for (const index of order) {
      review = applyReviewFix(review, ids[index])!;
      expect(review).toBeDefined();
      checkReferences(review);
    }
    expect(getReviewSteps(review)).toEqual([]);
    expect(
      review.findings.every((finding) => finding.status === 'accepted'),
    ).toBe(true);
    expect(review.code).toContain('WHERE id = $1');
    expect(review.code).toContain('if (users.length === 0)');
    expect(review.code).not.toContain('console.log');
    expect(applyReviewFix(review, ids[0])).toBeUndefined();
  }
});

it('marks overlapping and unresolvable references for recheck without drawing stale flows', async () => {
  const [review] = await createMockReviewApi(undefined, 0).listReviews();
  const [sql, empty] = getReviewSteps(review);
  const overlap = { ...empty, id: 'overlap', lineStart: 4, lineEnd: 6 };
  const lostReference = { ...empty, id: 'lost', steps: [sql.steps[1]] };
  const input = {
    ...review,
    guideFindings: [sql, overlap, lostReference],
    findings: [
      review.findings[0],
      ...['overlap', 'lost'].map((id) => ({ ...review.findings[1], id })),
    ],
  };
  const updated = applyReviewFix(input, sql.id)!;
  for (const guide of getReviewSteps(updated)) {
    expect(guide.state).toBe('needs-recheck');
    expect(guide.edit).toBeUndefined();
    expect(guide.steps.every((step) => !step.links && !step.flow)).toBe(true);
    expect(applyReviewFix(updated, guide.id)).toBeUndefined();
    expect(
      updated.findings.find((finding) => finding.id === guide.id)?.needsRecheck,
    ).toBe(true);
  }
});

it('keeps an ambiguous relocated variable out of the editor', async () => {
  const [review] = await createMockReviewApi(undefined, 0).listReviews();
  const [sql, empty] = getReviewSteps(review);
  const changedSql = {
    ...sql,
    edit: {
      ...sql.edit!,
      replacement:
        '  const users = await read();\n  const users = await read();',
    },
  };
  const input = { ...review, guideFindings: [changedSql, empty] };
  const updated = applyReviewFix(input, sql.id)!;
  expect(getReviewSteps(updated)[0].state).toBe('needs-recheck');
});

it('does not relocate a removed variable into an unrelated string literal', async () => {
  const [review] = await createMockReviewApi(undefined, 0).listReviews();
  const [sql, empty] = getReviewSteps(review);
  const changedSql = {
    ...sql,
    edit: { ...sql.edit!, replacement: '  const rows = await read("users");' },
  };
  const updated = applyReviewFix(
    { ...review, guideFindings: [changedSql, empty] },
    sql.id,
  )!;
  expect(getReviewSteps(updated)[0].state).toBe('needs-recheck');
  expect(getReviewSteps(updated)[0].steps.every((step) => !step.flow)).toBe(
    true,
  );
});
