import type { ReviewResponse } from './client';
import type { Finding, Review } from '../types/review';

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

export function attachReview(snippet: Review, result: ReviewResponse): Review {
  return {
    ...snippet,
    summary: result.summary,
    reviewPhase: result.phase,
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
      detailStatus: finding.detailStatus,
      detailError: finding.detailError,
      suggestion: finding.steps.at(-1)?.description ?? '',
      suggestedCode: finding.fix,
      status: 'open',
      comments: [],
    })),
    // Store full guides even for the demo snippet; never substitute canned guides.
    guideFindings: result.findings,
  };
}
