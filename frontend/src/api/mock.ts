import { createSnippetStore } from './store';
import { examples } from './examples';
import type {
  Finding,
  FindingStatus,
  Review,
  ReviewApi,
  ReviewInput,
} from '../types/review';

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function analyze(input: ReviewInput): Finding[] {
  const findings: Finding[] = [];
  const lines = input.code.split('\n');
  const add = (
    line: number,
    finding: Omit<
      Finding,
      'id' | 'lineStart' | 'lineEnd' | 'status' | 'comments'
    >,
  ) => {
    findings.push({
      ...finding,
      id: crypto.randomUUID(),
      lineStart: line,
      lineEnd: line,
      status: 'open',
      comments: [],
    });
  };
  lines.forEach((line, index) => {
    if (
      /\bSELECT\b/i.test(line) &&
      (/\$\{/.test(line) || /Sprintf|\+\s*\w|\{\w+\}/.test(line))
    ) {
      add(index + 1, {
        title: 'User input is interpolated into SQL',
        severity: 'high',
        category: 'Security',
        description:
          'Building a SQL query with user-provided values can let an attacker change the query. Treat the ID as data rather than part of the SQL statement.',
        suggestion:
          'Use a parameterized query. The placeholder syntax depends on your database driver.',
        suggestedCode:
          input.language === 'go'
            ? 'return db.Query("SELECT * FROM users WHERE id = $1", id)'
            : 'const users = await db.query(\n  "SELECT * FROM users WHERE id = $1",\n  [userId],\n);',
      });
    }
    if (/\beval\s*\(/.test(line)) {
      add(index + 1, {
        title: 'Untrusted input can execute code',
        severity: 'high',
        category: 'Security',
        description:
          'eval executes its input as code. A user-controlled expression may run operations well beyond the intended calculation.',
        suggestion:
          'Use a restricted expression parser with an explicit allowlist of operations.',
        suggestedCode:
          input.language === 'python'
            ? '# Use a restricted expression parser instead of eval.\nresult = parse_allowed_expression(expression)'
            : '// Use a restricted expression parser instead of eval.\nconst result = parseAllowedExpression(expression);',
      });
    }
    if (
      ['typescript', 'javascript'].includes(input.language) &&
      /return\s+users\[0\]/.test(line)
    ) {
      add(index + 1, {
        title: 'Handle the case where no user is found',
        severity: 'medium',
        category: 'Reliability',
        description:
          'An empty result set makes users[0] undefined. Callers may expect a user object and fail later with an unrelated error.',
        suggestion:
          'Make the missing-user behavior explicit and reflect it in the function’s return type.',
        suggestedCode:
          'if (users.length === 0) {\n  return null;\n}\n\nreturn users[0];',
      });
    }
    if (/\bconsole\.log\s*\(|^\s*print\s*\(/.test(line)) {
      add(index + 1, {
        title: 'Keep sensitive values out of logs',
        severity: 'low',
        category: 'Maintainability',
        description:
          'This debug statement prints the full result. If that value contains personal data, it could end up in application logs.',
        suggestion:
          'Remove the debug statement, or log only the non-sensitive fields needed for diagnosis.',
        suggestedCode:
          input.language === 'python'
            ? '# Remove the debug statement or use a logger with redaction.'
            : '// Remove the debug statement or use a logger with redaction.',
      });
    }
  });
  const order = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

function create(input: ReviewInput): Review {
  const findings = analyze(input);
  return {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    findings,
    summary: findings.length
      ? `A few things to consider before this snippet ships. Start with ${findings.some((finding) => finding.severity === 'high') ? 'the security findings' : 'the open findings'}, then work through the smaller improvements.`
      : 'No demo patterns matched this snippet. This is a limited mock review, not a guarantee of correctness.',
  };
}

/** Deterministic review fixture for UI tests; the app uses reviews.ts. */
export function createMockReviewApi(
  storage?: Storage,
  latency = 900,
): ReviewApi {
  const store = createSnippetStore(storage, {
    key: 'reviewlet.mock-reviews.v1',
    initial: [create(examples.database)],
  });
  return {
    ...store,
    async listReviews() {
      await delay(latency / 4);
      return store.listReviews();
    },
    async saveSnippet(id, input) {
      const result = await store.saveSnippet(id, input);
      await delay(latency / 4);
      return result;
    },
    async saveReviewRevision(review, expectedCode) {
      const result = await store.saveReviewRevision(review, expectedCode);
      await delay(latency / 4);
      return result;
    },
    async deleteSnippet(id) {
      await store.deleteSnippet(id);
      await delay(latency / 4);
    },
    async createReview(input) {
      if (!input.code.trim())
        throw new Error('Add a code snippet before starting your review.');
      if (input.code.length > 30_000)
        throw new Error('Keep your snippet under 30,000 characters.');
      if (!input.title.trim()) throw new Error('Give your snippet a title.');
      await delay(latency);
      const review = create({ ...input, title: input.title.trim() });
      await store.saveSnippet(review.id, review);
      return store.saveReviewRevision(review, review.code);
    },
    async reviewSnippet(id, input) {
      if (!input.code.trim())
        throw new Error('Add a code snippet before starting your review.');
      if (input.code.length > 30_000)
        throw new Error('Keep your snippet under 30,000 characters.');
      await delay(latency);
      const existing = (await store.listReviews()).find(
        (review) => review.id === id,
      );
      if (!existing) throw new Error('This snippet is no longer available.');
      const review = {
        ...create({
          ...input,
          title: input.title.trim() || 'Untitled snippet',
        }),
        id,
        createdAt: existing.createdAt,
      };
      await store.saveSnippet(id, input);
      return store.saveReviewRevision(review, input.code);
    },
    async updateFinding(reviewId, findingId, status: FindingStatus) {
      await delay(latency / 4);
      return store.updateFinding(reviewId, findingId, status);
    },
    async discussFinding(reviewId, findingId, message) {
      await delay(latency);
      const review = await store.discussFinding(reviewId, findingId, message);
      const finding = review.findings.find((item) => item.id === findingId)!;
      finding.comments.push({
        id: crypto.randomUUID(),
        author: 'reviewer',
        createdAt: new Date().toISOString(),
        body: `Mock reviewer: ${finding.description}\n\n${finding.suggestion}\n\nThis is a predefined explanation for this finding, not an AI-generated answer.`,
      });
      return store.saveReviewRevision(review, review.code);
    },
  };
}
