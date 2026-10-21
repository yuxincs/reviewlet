import { expect, it } from 'vitest';
import { applyCodeEdit } from './codeEdits';
import { examples } from './api/examples';
import { demoReviewFindings } from './demoReviewGuide';

it('applies the complete SQL fix without leaving the unsafe query behind', () => {
  const code = applyCodeEdit(
    examples.database.code,
    demoReviewFindings[0].edit!,
  );
  expect(code).toContain('WHERE id = $1');
  expect(code).toContain('    [userId],');
  expect(code).not.toContain('const query');
  expect(code).toContain("  console.log('User result:', users);");
  expect(code).toContain('  return users[0];');
});

it('handles deletions and end-of-file edits without damaging surrounding lines', () => {
  const original = examples.database.code;
  expect(applyCodeEdit(original, demoReviewFindings[2].edit!)).toBe(
    original
      .split('\n')
      .filter((_, index) => index !== 6)
      .join('\n'),
  );
  expect(
    applyCodeEdit('before\nlast', {
      startLine: 2,
      endLine: 2,
      original: 'last',
      replacement: 'new\nlast',
    }),
  ).toBe('before\nnew\nlast');
});

it('rejects stale, invalid, and oversized replacements', () => {
  const edit = demoReviewFindings[0].edit!;
  expect(
    applyCodeEdit(
      examples.database.code.replace('const query', 'let query'),
      edit,
    ),
  ).toBeUndefined();
  expect(
    applyCodeEdit(examples.database.code, { ...edit, startLine: 0 }),
  ).toBeUndefined();
  expect(
    applyCodeEdit(examples.database.code, { ...edit, endLine: 100 }),
  ).toBeUndefined();
  expect(
    applyCodeEdit(examples.database.code, {
      ...edit,
      replacement: 'a'.repeat(30_001),
    }),
  ).toBeUndefined();
});
