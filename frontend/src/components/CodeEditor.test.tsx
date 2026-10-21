import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { CodeEditor } from './CodeEditor';
import type { Finding } from '../types/review';

afterEach(cleanup);

it('marks every line in finding ranges and uses the highest overlapping severity', () => {
  const finding: Finding = {
    id: 'suggestion',
    title: 'Example finding',
    severity: 'low',
    category: 'Maintainability',
    lineStart: 1,
    lineEnd: 3,
    description: '',
    suggestion: '',
    suggestedCode: '',
    status: 'open',
    comments: [],
  };
  const { container } = render(
    <CodeEditor
      code={'one\ntwo\nthree\nfour\nfive'}
      language="typescript"
      findings={[
        finding,
        { ...finding, id: 'bug', severity: 'high', lineStart: 2, lineEnd: 4 },
      ]}
      onChange={() => {}}
      disabled={false}
    />,
  );
  const lines = container.querySelectorAll('.code-line');
  expect(lines[0].classList.contains('finding-line-low')).toBe(true);
  for (const index of [1, 2, 3])
    expect(lines[index].classList.contains('finding-line-high')).toBe(true);
  expect(lines[4].classList.contains('finding-line')).toBe(false);
  expect(container.querySelectorAll('.finding-line-number')).toHaveLength(4);
});
