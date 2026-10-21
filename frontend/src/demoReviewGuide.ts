import { examples } from './api/examples';
import type { Review, Severity, Finding } from './types/review';

export interface GuideRange {
  symbolId?: string;
  line: number;
  startColumn: number;
  endColumn: number;
  symbol: string;
  role: 'source' | 'transform' | 'sink';
}
export interface GuideFlowNode {
  label: string;
  flowKey?: string;
  reference?: GuideRange;
}
export interface GuideFlow {
  kind: 'current' | 'proposed';
  nodes: GuideFlowNode[];
}
export interface GuideStep {
  description: string;
  links?: GuideRange[];
  flow?: GuideFlow;
}
export type GuideSeverity = 'critical' | 'warning' | 'info';
export type GuideCategory = 'bug' | 'style' | 'performance' | 'security';
export interface GuideFinding {
  id: string;
  summary: string;
  severity: GuideSeverity;
  category: GuideCategory;
  lineStart: number;
  lineEnd: number;
  steps: GuideStep[];
  fix: string;
}

// Locations are one-based, with an exclusive end column, and apply only to this exact example.
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

export const demoReviewFindings: GuideFinding[] = [
  {
    id: 'sql-input',
    lineStart: 4,
    lineEnd: 4,
    summary: 'SQL injection risk',
    severity: 'critical',
    category: 'security',
    steps: [
      {
        description: 'userId flows from the parameter into the SQL string.',
        links: [
          occurrence(3, 'userId', 'source'),
          occurrence(4, 'userId', 'source'),
        ],
      },
      {
        description: 'The interpolated query reaches db.query for execution.',
        links: [
          occurrence(4, 'query', 'transform'),
          occurrence(6, 'query', 'transform', true),
          occurrence(6, 'db.query', 'sink'),
        ],
      },
      { description: 'Untrusted input could change the SQL statement.' },
      {
        description:
          'Bind userId as a query parameter instead of interpolating it.',
        links: [occurrence(4, 'userId', 'source')],
      },
    ],
    fix: 'const users = await db.query(\n  "SELECT * FROM users WHERE id = $1",\n  [userId],\n);',
  },
  {
    id: 'empty-result',
    lineStart: 9,
    lineEnd: 9,
    summary: 'Missing user is unchecked',
    severity: 'warning',
    category: 'bug',
    steps: [
      {
        description: 'users flows from the query result into the return.',
        links: [
          occurrence(6, 'users', 'source'),
          occurrence(9, 'users', 'sink'),
        ],
      },
      {
        description:
          'If the adapter returns an empty array, users[0] is undefined.',
        links: [occurrence(9, 'users', 'sink')],
      },
      { description: 'Return null or a domain error when no user matches.' },
      {
        description:
          'Make the missing-user outcome explicit in the return type.',
      },
    ],
    fix: 'if (users.length === 0) {\n  return null;\n}\n\nreturn users[0];',
  },
  {
    id: 'logging',
    lineStart: 7,
    lineEnd: 7,
    summary: 'User data may reach logs',
    severity: 'info',
    category: 'security',
    steps: [
      {
        description: 'The full users result is passed to console.log.',
        links: [
          occurrence(6, 'users', 'source'),
          occurrence(7, 'users', 'source'),
          occurrence(7, 'console.log', 'sink'),
        ],
      },
      { description: 'SELECT * may include personal or sensitive fields.' },
      { description: 'Check the returned fields and who can access the logs.' },
      {
        description:
          'Remove the log or record only approved, non-sensitive metadata.',
      },
    ],
    fix: '// Remove the full-result debug log.\n// If needed, log only approved, non-sensitive metadata.',
  },
];

const flow = (
  kind: GuideFlow['kind'],
  ...nodes: GuideFlowNode[]
): GuideFlow => {
  const variableIdentity = (node: GuideFlowNode) =>
    node.reference?.symbolId ??
    (/^[a-zA-Z_$][\w$]*$/.test(node.reference?.symbol ?? '')
      ? node.reference!.symbol
      : undefined);
  let previous = 'value';
  return {
    kind,
    nodes: nodes.map((node, index) => {
      const own = variableIdentity(node);
      const following = nodes
        .slice(index + 1)
        .map((next) => variableIdentity(next))
        .find(Boolean);
      const key = own ?? (index === 0 ? following : previous) ?? 'value';
      previous = key;
      return { ...node, flowKey: key };
    }),
  };
};
const node = (label: string, reference?: GuideRange): GuideFlowNode => ({
  label,
  reference,
});

const demoFlows: GuideFlow[][] = [
  [
    flow(
      'current',
      node('userId parameter', occurrence(3, 'userId', 'source')),
      node('SQL interpolation', occurrence(4, 'userId', 'source')),
      node('query string', occurrence(4, 'query', 'transform')),
    ),
    flow(
      'current',
      node('query string', occurrence(4, 'query', 'transform')),
      node('query argument', occurrence(6, 'query', 'transform', true)),
      node('db.query', occurrence(6, 'db.query', 'sink')),
    ),
    flow(
      'current',
      node('untrusted userId', occurrence(4, 'userId', 'source')),
      node('SQL text', occurrence(4, 'query', 'transform')),
      node('database execution', occurrence(6, 'db.query', 'sink')),
    ),
    flow(
      'proposed',
      node('userId', occurrence(4, 'userId', 'source')),
      node('bound parameter'),
      node('query executes with input treated as data'),
    ),
  ],
  [
    flow(
      'current',
      node('db.query', occurrence(6, 'db.query', 'source')),
      node('users result', occurrence(6, 'users', 'transform')),
      node('users[0] return', occurrence(9, 'users', 'sink')),
    ),
    flow(
      'current',
      node('empty users result', occurrence(9, 'users', 'source')),
      node('users[0] lookup'),
      node('undefined result'),
    ),
    flow(
      'proposed',
      node('users result', occurrence(6, 'users', 'source')),
      node('check for no matches'),
      node('return null or a domain error'),
    ),
    flow(
      'proposed',
      node('lookup result', occurrence(9, 'users', 'source')),
      node('explicit User | null return type'),
      node('caller handles the missing user'),
    ),
  ],
  [
    flow(
      'current',
      node('users result', occurrence(6, 'users', 'source')),
      node('users argument', occurrence(7, 'users', 'transform')),
      node('console.log', occurrence(7, 'console.log', 'sink')),
    ),
    flow(
      'current',
      node('SELECT *', occurrence(4, 'SELECT *', 'source')),
      node('users result', occurrence(6, 'users', 'transform')),
      node('potentially sensitive fields'),
    ),
    flow(
      'current',
      node('users argument', occurrence(7, 'users', 'source')),
      node('console.log', occurrence(7, 'console.log', 'sink')),
      node('application logs and their readers'),
    ),
    flow(
      'proposed',
      node('users result', occurrence(6, 'users', 'source')),
      node('approved, non-sensitive metadata'),
      node('redacted logger, if needed'),
    ),
  ],
];
for (const [findingIndex, finding] of demoReviewFindings.entries()) {
  finding.steps.forEach((step, stepIndex) => {
    step.flow = demoFlows[findingIndex][stepIndex];
  });
}

export function hasDemoReviewGuide(review: Review): boolean {
  return (
    review.language === examples.database.language &&
    review.code === examples.database.code &&
    Boolean(review.summary)
  );
}

// Adapt the existing mock API vocabulary without changing saved snippet data.
const severities: Record<Severity, GuideSeverity> = {
  high: 'critical',
  medium: 'warning',
  low: 'info',
};
const categories: Record<Finding['category'], GuideCategory> = {
  Security: 'security',
  Reliability: 'bug',
  Maintainability: 'style',
};

export function getReviewSteps(review: Review): GuideFinding[] {
  if (hasDemoReviewGuide(review)) return demoReviewFindings;
  return review.findings.map((finding) => ({
    id: finding.id,
    summary: finding.title,
    severity: severities[finding.severity],
    category: categories[finding.category],
    lineStart: finding.lineStart,
    lineEnd: finding.lineEnd,
    steps: [finding.description, finding.suggestion].flatMap((text) =>
      text
        .split(/(?<=[.!?])\s+(?=[A-Z])/u)
        .filter(Boolean)
        .map((description) => ({ description })),
    ),
    fix: finding.suggestedCode,
  }));
}
