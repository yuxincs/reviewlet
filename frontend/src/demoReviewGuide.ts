import { examples } from './api/examples';
import type { Review, Severity } from './types/review';

export interface GuideRange {
  line: number;
  startColumn: number;
  endColumn: number;
  symbol: string;
  role: 'source' | 'transform' | 'sink';
}
export interface GuideStep {
  id: string;
  title: string;
  severity: Severity;
  lineStart: number;
  lineEnd: number;
  explanation: string;
  check: string;
  fix: string;
  ranges: GuideRange[];
}

// These locations belong only to the exact database example, not arbitrary code.
function occurrence(
  line: number,
  symbol: string,
  role: GuideRange['role'],
  last = false,
): GuideRange {
  const text = examples.database.code.split('\n')[line - 1];
  const startColumn =
    (last ? text.lastIndexOf(symbol) : text.indexOf(symbol)) + 1;
  return {
    line,
    symbol,
    role,
    startColumn,
    endColumn: startColumn + symbol.length,
  };
}

export const demoReviewSteps: GuideStep[] = [
  {
    id: 'sql-input',
    lineStart: 4,
    lineEnd: 4,
    title: 'Follow the input into SQL',
    severity: 'high',
    explanation:
      'userId enters as a function parameter, becomes part of the query string, and reaches db.query. If the caller supplies untrusted input, it can change the SQL statement rather than just its ID value.',
    check:
      'Trace userId → query → db.query. The TypeScript string type does not make this value safe for SQL.',
    fix: 'const users = await db.query(\n  "SELECT * FROM users WHERE id = $1",\n  [userId],\n);',
    ranges: [
      occurrence(3, 'userId', 'source'),
      occurrence(4, 'userId', 'source'),
      occurrence(4, 'query', 'transform'),
      occurrence(6, 'query', 'transform', true),
      occurrence(6, 'db.query', 'sink'),
    ],
  },
  {
    id: 'empty-result',
    lineStart: 9,
    lineEnd: 9,
    title: 'Check the empty-result path',
    severity: 'medium',
    explanation:
      'The users value comes from the database and is indexed at the return. Assuming this adapter returns an array, no matching rows means users[0] is undefined. The snippet does not define how callers should handle that outcome.',
    check:
      'Follow users from the query result to the return. Decide whether a missing user should return null or raise a domain error.',
    fix: 'if (users.length === 0) {\n  return null;\n}\n\nreturn users[0];',
    ranges: [occurrence(6, 'users', 'source'), occurrence(9, 'users', 'sink')],
  },
  {
    id: 'logging',
    lineStart: 7,
    lineEnd: 7,
    title: 'Review what leaves through logs',
    severity: 'low',
    explanation:
      'The same users result is passed to console.log. SELECT * may include personal or sensitive fields, so logging the complete result could expose them. The actual risk depends on the schema and logging environment.',
    check:
      'Follow users into console.log. Check which fields the query returns and where application logs are stored.',
    fix: '// Remove the full-result debug log.\n// If needed, log only approved, non-sensitive metadata.',
    ranges: [
      occurrence(6, 'users', 'source'),
      occurrence(7, 'users', 'source'),
      occurrence(7, 'console.log', 'sink'),
    ],
  },
];

export function hasDemoReviewGuide(review: Review): boolean {
  return (
    review.language === examples.database.language &&
    review.code === examples.database.code &&
    Boolean(review.summary)
  );
}

export function getReviewSteps(review: Review): GuideStep[] {
  if (hasDemoReviewGuide(review)) return demoReviewSteps;
  return review.findings.map((finding) => ({
    id: finding.id,
    title: finding.title,
    severity: finding.severity,
    lineStart: finding.lineStart,
    lineEnd: finding.lineEnd,
    explanation: finding.description,
    check: finding.suggestion,
    fix: finding.suggestedCode,
    ranges: [],
  }));
}
