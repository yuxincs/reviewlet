import { expect, it } from 'vitest';
import { examples } from './api/examples';
import { demoReviewFindings } from './demoReviewGuide';

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
