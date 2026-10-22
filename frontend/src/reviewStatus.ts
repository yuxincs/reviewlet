import type { Review } from './types/review';

export type ReviewStatus = NonNullable<Review['reviewStatus']>;
export const reviewStatusLabels: Record<ReviewStatus, string> = {
  draft: 'Unreviewed',
  reviewing: 'Reviewing',
  reviewed: 'Reviewed',
  stale: 'Edited since review',
  failed: 'Review failed',
};

export function getReviewStatus(
  review: Review,
  reviewingIds?: ReadonlySet<string>,
): ReviewStatus {
  if (reviewingIds?.has(review.id)) return 'reviewing';
  return (
    review.reviewStatus ??
    (review.analysis || review.findings.length ? 'reviewed' : 'draft')
  );
}
