import { examples } from './examples';
import type {
  Comment,
  Finding,
  FindingStatus,
  Review,
  ReviewApi,
  ReviewInput,
} from '../types/review';

const STORAGE_KEY = 'reviewlet.mock-reviews.v1';
const MAX_REVIEWS = 20;
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
    typeof value.lineStart === 'number' &&
    typeof value.lineEnd === 'number' &&
    Array.isArray(value.comments) &&
    value.comments.every(isComment)
  );
}
function isReview(value: unknown): value is Review {
  return (
    isRecord(value) &&
    ['id', 'title', 'code', 'context', 'createdAt', 'summary'].every(
      (key) => typeof value[key] === 'string',
    ) &&
    ['typescript', 'javascript', 'python', 'go'].includes(
      String(value.language),
    ) &&
    Array.isArray(value.findings) &&
    value.findings.every(isFinding)
  );
}

/** Async mock transport. Replace this adapter with HTTP calls when the API is ready. */
export function createMockReviewApi(
  storage?: Storage,
  latency = 900,
): ReviewApi {
  let reviews: Review[] = [create(examples.database)];
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isReview))
      reviews = parsed.slice(0, MAX_REVIEWS);
  } catch {
    /* A corrupt or unavailable browser store starts a fresh demo session. */
  }
  const save = () => {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(reviews));
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
      await delay(latency / 4);
      return snapshot(reviews);
    },
    async saveSnippet(id, input) {
      if (input.code.length > 30_000)
        throw new Error('Keep your snippet under 30,000 characters.');
      const existing = reviews.find((review) => review.id === id);
      const codeChanged =
        existing &&
        (existing.code !== input.code || existing.language !== input.language);
      const snippet: Review = {
        id,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        summary: codeChanged ? '' : (existing?.summary ?? ''),
        findings: codeChanged ? [] : (existing?.findings ?? []),
        title: input.title.trim() || 'Untitled snippet',
        code: input.code,
        language: input.language,
        context: input.context,
      };
      reviews = existing
        ? reviews.map((review) => (review.id === id ? snippet : review))
        : [snippet, ...reviews].slice(0, MAX_REVIEWS);
      // Store immediately so quick edits and navigation keep their original order.
      save();
      await delay(latency / 4);
      return snapshot(snippet);
    },
    async createReview(input) {
      if (!input.code.trim())
        throw new Error('Add a code snippet before starting your review.');
      if (input.code.length > 30_000)
        throw new Error('Keep your snippet under 30,000 characters.');
      if (!input.title.trim()) throw new Error('Give your snippet a title.');
      await delay(latency);
      const review = create({ ...input, title: input.title.trim() });
      reviews = [review, ...reviews].slice(0, MAX_REVIEWS);
      save();
      return snapshot(review);
    },
    async updateFinding(reviewId, findingId, status: FindingStatus) {
      await delay(latency / 4);
      const { review, finding } = find(reviewId, findingId);
      finding.status = status;
      save();
      return snapshot(review);
    },
    async discussFinding(reviewId, findingId, message) {
      const body = message.trim();
      if (!body || body.length > 2000)
        throw new Error('Write a message between 1 and 2,000 characters.');
      await delay(latency);
      const { review, finding } = find(reviewId, findingId);
      const now = new Date().toISOString();
      finding.comments.push(
        { id: crypto.randomUUID(), author: 'you', body, createdAt: now },
        {
          id: crypto.randomUUID(),
          author: 'reviewer',
          body: `Mock reviewer: ${finding.description}\n\n${finding.suggestion}\n\nThis is a predefined explanation for this finding, not an AI-generated answer.`,
          createdAt: now,
        },
      );
      save();
      return snapshot(review);
    },
  };
}

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
export const reviewApi = createMockReviewApi(browserStorage());
