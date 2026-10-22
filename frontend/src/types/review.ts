import type { GuideFinding } from './guide';

export type Language =
  'unknown' | 'typescript' | 'javascript' | 'python' | 'go';
export type FindingStatus = 'open' | 'accepted' | 'dismissed';
export type Severity = 'high' | 'medium' | 'low';

export interface ReviewInput {
  title: string;
  language: Language;
  languageMode?: 'auto' | 'manual';
  code: string;
  context: string;
}

export interface Comment {
  id: string;
  author: 'you' | 'reviewer';
  body: string;
  createdAt: string;
}

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  category: 'Security' | 'Reliability' | 'Maintainability';
  lineStart: number;
  lineEnd: number;
  description: string;
  suggestion: string;
  suggestedCode: string;
  status: FindingStatus;
  detailStatus?: 'pending' | 'ready' | 'failed';
  detailError?: string;
  needsRecheck?: boolean;
  comments: Comment[];
}

export interface Review extends ReviewInput {
  reviewPhase?: 'detailing' | 'complete';
  reviewStatus?: 'draft' | 'reviewing' | 'reviewed' | 'stale' | 'failed';
  id: string;
  createdAt: string;
  summary: string;
  findings: Finding[];
  guideFindings?: GuideFinding[];
  // Metadata for the original server review; local fixes may remap its findings.
  analysis?: {
    id: string;
    createdAt: string;
    codeHash: string;
    language: string;
  };
}

export interface ReviewApi {
  listReviews(): Promise<Review[]>;
  saveSnippet(id: string, input: ReviewInput): Promise<Review>;
  saveReviewRevision(review: Review, expectedCode: string): Promise<Review>;
  deleteSnippet(id: string): Promise<void>;
  createReview(input: ReviewInput): Promise<Review>;
  reviewSnippet(
    id: string,
    input: ReviewInput,
    signal?: AbortSignal,
    onProgress?: (review: Review) => void,
  ): Promise<Review>;
  updateFinding(
    reviewId: string,
    findingId: string,
    status: FindingStatus,
  ): Promise<Review>;
  discussFinding(
    reviewId: string,
    findingId: string,
    message: string,
  ): Promise<Review>;
}
