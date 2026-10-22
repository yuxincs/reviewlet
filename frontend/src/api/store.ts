import type {
  Comment,
  Finding,
  FindingStatus,
  Review,
  ReviewApi,
} from '../types/review';

type SnippetStore = Omit<ReviewApi, 'createReview' | 'reviewSnippet'>;
const MAX_REVIEWS = 20;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function isComment(value: unknown): value is Comment {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.body === 'string' &&
    typeof value.createdAt === 'string' &&
    ['you', 'reviewer'].includes(String(value.author))
  );
}
function isFinding(value: unknown): value is Finding {
  return (
    isRecord(value) &&
    ['id', 'title', 'description', 'suggestion', 'suggestedCode'].every(
      (key) => typeof value[key] === 'string',
    ) &&
    ['high', 'medium', 'low'].includes(String(value.severity)) &&
    ['Security', 'Reliability', 'Maintainability'].includes(
      String(value.category),
    ) &&
    ['open', 'accepted', 'dismissed'].includes(String(value.status)) &&
    (value.needsRecheck === undefined ||
      typeof value.needsRecheck === 'boolean') &&
    typeof value.lineStart === 'number' &&
    typeof value.lineEnd === 'number' &&
    Array.isArray(value.comments) &&
    value.comments.every(isComment)
  );
}
function isRange(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.symbol === 'string' &&
    ['line', 'startColumn', 'endColumn'].every(
      (key) => Number.isInteger(value[key]) && Number(value[key]) > 0,
    ) &&
    (value.symbolId === undefined || typeof value.symbolId === 'string') &&
    ['source', 'transform', 'sink'].includes(String(value.role))
  );
}
function isGuideFinding(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !['id', 'summary', 'description', 'fix'].every(
      (key) => typeof value[key] === 'string',
    ) ||
    !['critical', 'warning', 'info'].includes(String(value.severity)) ||
    !['bug', 'style', 'performance', 'security'].includes(
      String(value.category),
    ) ||
    !['lineStart', 'lineEnd'].every(
      (key) => Number.isInteger(value[key]) && Number(value[key]) > 0,
    ) ||
    (value.state !== undefined &&
      (typeof value.state !== 'string' ||
        !['current', 'resolved', 'needs-recheck'].includes(value.state)))
  )
    return false;
  if (
    value.edit !== undefined &&
    (!isRecord(value.edit) ||
      typeof value.edit.original !== 'string' ||
      typeof value.edit.replacement !== 'string' ||
      !Number.isInteger(value.edit.startLine) ||
      !Number.isInteger(value.edit.endLine))
  )
    return false;
  return (
    Array.isArray(value.steps) &&
    value.steps.every((step: unknown) => {
      if (!isRecord(step) || typeof step.description !== 'string') return false;
      if (
        step.links !== undefined &&
        (!Array.isArray(step.links) || !step.links.every(isRange))
      )
        return false;
      const flow = step.flow;
      if (flow === undefined) return true;
      return (
        isRecord(flow) &&
        ['current', 'proposed'].includes(String(flow.kind)) &&
        Array.isArray(flow.nodes) &&
        flow.nodes.every(
          (node: unknown) =>
            isRecord(node) &&
            typeof node.label === 'string' &&
            (node.reference === undefined || isRange(node.reference)) &&
            (node.sampleValue === undefined ||
              typeof node.sampleValue === 'string') &&
            (node.flowKey === undefined || typeof node.flowKey === 'string'),
        ) &&
        (flow.connections === undefined ||
          (Array.isArray(flow.connections) &&
            flow.connections.every(
              (edge: unknown) =>
                isRecord(edge) &&
                Number.isInteger(edge.from) &&
                Number.isInteger(edge.to),
            )))
      );
    })
  );
}
function isAnalysis(value: unknown): boolean {
  return (
    isRecord(value) &&
    ['id', 'createdAt', 'codeHash', 'language'].every(
      (key) => typeof value[key] === 'string',
    )
  );
}
function isReview(value: unknown): value is Review {
  return (
    isRecord(value) &&
    ['id', 'title', 'code', 'context', 'createdAt', 'summary'].every(
      (key) => typeof value[key] === 'string',
    ) &&
    [
      'unknown',
      'typescript',
      'javascript',
      'python',
      'go',
      'rust',
      'java',
    ].includes(String(value.language)) &&
    (value.languageMode === undefined ||
      value.languageMode === 'auto' ||
      value.languageMode === 'manual') &&
    Array.isArray(value.findings) &&
    value.findings.every(isFinding) &&
    (value.analysis === undefined || isAnalysis(value.analysis)) &&
    (value.guideFindings === undefined ||
      (Array.isArray(value.guideFindings) &&
        value.guideFindings.every(isGuideFinding)))
  );
}

export function createSnippetStore(
  storage?: Storage,
  {
    key = 'reviewlet.snippets.v1',
    initial = [],
    migrateFrom,
  }: {
    key?: string;
    initial?: Review[];
    migrateFrom?: string;
  } = {},
): SnippetStore {
  let reviews = structuredClone(initial);
  try {
    const saved = storage?.getItem(key);
    const legacy =
      saved == null && migrateFrom ? storage?.getItem(migrateFrom) : null;
    const parsed: unknown = JSON.parse(saved ?? legacy ?? 'null');
    if (Array.isArray(parsed) && parsed.every(isReview)) {
      reviews = parsed.slice(0, MAX_REVIEWS);
      if (legacy != null) {
        // Keep saved code, but never present old mock findings as real reviews.
        reviews = reviews.map(
          ({ id, title, language, code, context, createdAt }) => ({
            id,
            title,
            language,
            code,
            context,
            createdAt,
            summary: '',
            findings: [],
          }),
        );
      }
    }
  } catch {
    /* Corrupt or unavailable storage starts with the supplied snippets. */
  }
  const save = () => {
    try {
      storage?.setItem(key, JSON.stringify(reviews));
    } catch {
      /* Keep working in memory if storage is full or disabled. */
    }
  };
  const snapshot = <T>(value: T): T => structuredClone(value);
  const find = (reviewId: string, findingId: string) => {
    const review = reviews.find((item) => item.id === reviewId);
    const finding = review?.findings.find((item) => item.id === findingId);
    if (!review || !finding)
      throw new Error(
        'This finding is no longer available. Open the review again.',
      );
    return { review, finding };
  };
  save();
  return {
    async listReviews() {
      return Promise.resolve(snapshot(reviews));
    },
    async deleteSnippet(id) {
      reviews = reviews.filter((review) => review.id !== id);
      save();
      return Promise.resolve();
    },
    async saveSnippet(id, input) {
      if (input.code.length > 30_000)
        throw new Error('Keep your snippet under 30,000 characters.');
      const existing = reviews.find((review) => review.id === id);
      const codeChanged =
        existing &&
        (existing.code !== input.code ||
          existing.language !== input.language ||
          existing.context !== input.context);
      const snippet: Review = {
        ...(!codeChanged && existing?.analysis
          ? { analysis: existing.analysis }
          : {}),
        id,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        summary: codeChanged ? '' : (existing?.summary ?? ''),
        findings: codeChanged ? [] : (existing?.findings ?? []),
        ...(!codeChanged && existing?.guideFindings
          ? { guideFindings: existing.guideFindings }
          : {}),
        title: input.title.trim() || 'Untitled snippet',
        code: input.code,
        language: input.language,
        ...((input.languageMode ?? existing?.languageMode)
          ? { languageMode: input.languageMode ?? existing?.languageMode }
          : {}),
        context: input.context,
      };
      reviews = existing
        ? reviews.map((review) => (review.id === id ? snippet : review))
        : [snippet, ...reviews].slice(0, MAX_REVIEWS);
      // Store immediately so quick edits and navigation keep their original order.
      save();

      return Promise.resolve(snapshot(snippet));
    },
    async saveReviewRevision(review, expectedCode) {
      const existing = reviews.find((item) => item.id === review.id);
      if (!existing || existing.code !== expectedCode)
        throw new Error(
          'The snippet changed. Open the latest code before applying this fix.',
        );
      if (!isReview(review) || review.code.length > 30_000)
        throw new Error('Could not save this review revision.');
      const revision = snapshot({ ...review, createdAt: existing.createdAt });
      reviews = reviews.map((item) =>
        item.id === review.id ? revision : item,
      );
      save();

      return Promise.resolve(snapshot(revision));
    },
    async updateFinding(reviewId, findingId, status: FindingStatus) {
      const { review, finding } = find(reviewId, findingId);
      finding.status = status;
      save();
      return Promise.resolve(snapshot(review));
    },
    async discussFinding(reviewId, findingId, message) {
      const body = message.trim();
      if (!body || body.length > 2000)
        throw new Error('Write a message between 1 and 2,000 characters.');

      const { review, finding } = find(reviewId, findingId);
      const now = new Date().toISOString();
      finding.comments.push({
        id: crypto.randomUUID(),
        author: 'you',
        body,
        createdAt: now,
      });
      save();
      return Promise.resolve(snapshot(review));
    },
  };
}
