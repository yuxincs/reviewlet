import { expect, it } from 'vitest';
import { examples } from './api/examples';
import { demoReviewFindings, getFindingOverview } from './demoReviewGuide';

it('gives every demo step a directional flow with valid code references', () => {
  const lines = examples.database.code.split('\n');
  for (const finding of demoReviewFindings) {
    for (const step of finding.steps) {
      expect(step.flow?.nodes.length).toBeGreaterThanOrEqual(2);
      for (const node of step.flow!.nodes) {
        if (!node.reference) continue;
        const ref = node.reference;
        expect(ref.startColumn).toBeGreaterThan(0);
        expect(
          lines[ref.line - 1].slice(ref.startColumn - 1, ref.endColumn - 1),
        ).toBe(ref.symbol);
      }
    }
  }
});

it('merges current paths without duplicate nodes or edges', () => {
  const overview = getFindingOverview(demoReviewFindings[0]);
  expect(overview.flow!.nodes.map((node) => node.reference?.symbol)).toEqual([
    'userId',
    'userId',
    'query',
    'query',
    'db.query',
  ]);
  expect(overview.links).toHaveLength(5);
  expect(overview.flow!.connections).toHaveLength(4);
  expect(overview.flow!.connections).toContainEqual({ from: 0, to: 1 });
  expect(overview.flow!.connections).toContainEqual({ from: 3, to: 4 });
  expect(
    new Set(
      overview.flow!.connections!.map((edge) => `${edge.from}:${edge.to}`),
    ).size,
  ).toBe(overview.flow!.connections!.length);
});
it('does not invent flows across branches, abstract nodes, or proposed fixes', () => {
  const ref = (symbol: string, line: number) => ({
    symbol,
    line,
    startColumn: 1,
    endColumn: 2,
    role: 'source' as const,
  });
  const node = (symbol: string, line: number) => ({
    label: symbol,
    reference: ref(symbol, line),
  });
  const finding = {
    ...demoReviewFindings[0],
    steps: [
      {
        description: 'First path',
        flow: { kind: 'current' as const, nodes: [node('a', 1), node('b', 2)] },
      },
      {
        description: 'Second path',
        flow: {
          kind: 'current' as const,
          nodes: [node('c', 3), { label: 'unmapped' }, node('d', 4)],
        },
      },
      {
        description: 'Proposed',
        links: [ref('fix', 5)],
        flow: {
          kind: 'proposed' as const,
          nodes: [node('fix', 5), node('b', 2)],
        },
      },
    ],
  };
  const overview = getFindingOverview(finding);
  expect(overview.links?.map((ref) => ref.symbol)).toEqual([
    'a',
    'b',
    'c',
    'd',
  ]);
  expect(overview.flow?.connections).toEqual([{ from: 0, to: 1 }]);
  expect(
    getFindingOverview({
      ...finding,
      steps: [{ description: 'No references' }],
    }).links,
  ).toEqual([]);
});
