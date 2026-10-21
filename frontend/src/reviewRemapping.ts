import { applyCodeEdit, type CodeEdit } from './codeEdits';
import { getReviewSteps } from './demoReviewGuide';
import type { GuideFinding, GuideRange } from './types/guide';
import type { Review } from './types/review';

export function applyReviewFix(
  review: Review,
  findingId: string,
): Review | undefined {
  const guides = review.guideFindings ?? getReviewSteps(review);
  const finding = guides.find((guide) => guide.id === findingId);
  if (
    !finding?.edit ||
    finding.state === 'resolved' ||
    finding.state === 'needs-recheck'
  )
    return undefined;
  const edit = finding.edit;
  const code = applyCodeEdit(review.code, edit);
  if (code === undefined || code === review.code) return undefined;
  const replacement =
    edit.replacement === '' ? [] : edit.replacement.split('\n');
  const delta = replacement.length - (edit.endLine - edit.startLine + 1);
  const lastLine = code.split('\n').length;
  const overlaps = (start: number, end: number) =>
    start <= edit.endLine && end >= edit.startLine;
  const mapLine = (line: number) =>
    Math.max(
      1,
      Math.min(
        lastLine,
        line < edit.startLine
          ? line
          : line > edit.endLine
            ? line + delta
            : edit.startLine +
              Math.min(
                line - edit.startLine,
                Math.max(0, replacement.length - 1),
              ),
      ),
    );
  const mapRange = (range: { lineStart: number; lineEnd: number }) => ({
    lineStart: mapLine(range.lineStart),
    lineEnd: mapLine(range.lineEnd),
  });
  const mapGuide = (guide: GuideFinding): GuideFinding => {
    if (guide.id === findingId)
      return {
        ...guide,
        ...mapRange(guide),
        state: 'resolved',
        edit: undefined,
      };
    let needsRecheck =
      guide.state === 'needs-recheck' ||
      overlaps(guide.lineStart, guide.lineEnd);
    const mapReference = (reference: GuideRange): GuideRange | undefined => {
      if (reference.line < edit.startLine || reference.line > edit.endLine)
        return { ...reference, line: mapLine(reference.line) };
      const mapped = relocateReference(reference, review.code, edit);
      if (!mapped) needsRecheck = true;
      return mapped;
    };
    const steps = guide.steps.map((step) => ({
      ...step,
      links: step.links?.flatMap((reference) => {
        const mapped = mapReference(reference);
        return mapped ? [mapped] : [];
      }),
      flow: step.flow && {
        ...step.flow,
        nodes: step.flow.nodes.map((node) => ({
          ...node,
          reference: node.reference ? mapReference(node.reference) : undefined,
        })),
      },
    }));
    let nextEdit = guide.edit;
    if (nextEdit) {
      if (overlaps(nextEdit.startLine, nextEdit.endLine)) {
        needsRecheck = true;
        nextEdit = undefined;
      } else
        nextEdit = {
          ...nextEdit,
          startLine: mapLine(nextEdit.startLine),
          endLine: mapLine(nextEdit.endLine),
        };
    }
    const resolved = guide.state === 'resolved';
    return {
      ...guide,
      ...mapRange(guide),
      state: resolved ? 'resolved' : needsRecheck ? 'needs-recheck' : 'current',
      edit: needsRecheck ? undefined : nextEdit,
      // Keep stale explanations readable, without drawing obsolete code links.
      steps: needsRecheck
        ? steps.map((step) => ({ ...step, links: undefined, flow: undefined }))
        : steps,
    };
  };
  const guideFindings = guides.map(mapGuide);
  return {
    ...review,
    code,
    guideFindings,
    findings: review.findings.map((item) => {
      const guide = guideFindings.find((guide) => guide.id === item.id);
      return {
        ...item,
        ...(guide
          ? { lineStart: guide.lineStart, lineEnd: guide.lineEnd }
          : mapRange(item)),
        status: item.id === findingId ? 'accepted' : item.status,
        needsRecheck:
          item.status === 'open' &&
          item.id !== findingId &&
          (guide?.state === 'needs-recheck' ||
            overlaps(item.lineStart, item.lineEnd)),
      };
    }),
  };
}

// A surviving symbol inside a replaced block can move to another line/column.
// Prefer matching surrounding text; ambiguous or missing occurrences require recheck.
function relocateReference(
  reference: GuideRange,
  code: string,
  edit: CodeEdit,
): GuideRange | undefined {
  const original = code.split('\n')[reference.line - 1] ?? '';
  if (
    !reference.symbol ||
    original.slice(reference.startColumn - 1, reference.endColumn - 1) !==
      reference.symbol
  )
    return undefined;
  const before = original.slice(0, reference.startColumn - 1);
  const after = original.slice(reference.endColumn - 1);
  const candidates: { line: number; column: number; score: number }[] = [];
  for (const [line, text] of edit.replacement.split('\n').entries()) {
    let offset = text.indexOf(reference.symbol);
    while (offset !== -1) {
      const end = offset + reference.symbol.length;
      if (
        !(
          /[\w$]/.test(reference.symbol[0]) &&
          /[\w$.]/.test(text[offset - 1] ?? '')
        ) &&
        !(
          /[\w$]/.test(reference.symbol.at(-1) ?? '') &&
          /[\w$]/.test(text[end] ?? '')
        )
      ) {
        let left = 0,
          right = 0;
        while (
          left < 24 &&
          left < before.length &&
          left < offset &&
          before.at(-1 - left) === text[offset - 1 - left]
        )
          left++;
        while (
          right < 24 &&
          right < after.length &&
          end + right < text.length &&
          after[right] === text[end + right]
        )
          right++;
        candidates.push({
          line: edit.startLine + line,
          column: offset + 1,
          score:
            before.slice(before.length - left).trim().length +
            after.slice(0, right).trim().length,
        });
      }
      offset = text.indexOf(reference.symbol, offset + 1);
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || best.score === 0 || candidates[1]?.score === best.score)
    return undefined;
  return {
    ...reference,
    line: best.line,
    startColumn: best.column,
    endColumn: best.column + reference.symbol.length,
  };
}
