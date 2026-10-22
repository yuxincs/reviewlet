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
  reviewingId?: string,
): ReviewStatus {
  if (review.id === reviewingId) return 'reviewing';
  return (
    review.reviewStatus ??
    (review.analysis || review.findings.length ? 'reviewed' : 'draft')
  );
}
