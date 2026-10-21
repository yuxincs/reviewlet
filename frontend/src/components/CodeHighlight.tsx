import type { GuideRange } from '../demoReviewGuide';
import {
  flowColor,
  flowStyleForHue,
  referenceKey,
  useFlowPalette,
  type FlowColor,
} from '../flowColors';

const keywords =
  /^(import|from|export|async|await|function|const|let|return|if|else|null|undefined|def|func|string|error|type|interface)$/;
export function CodeHighlight({
  line,
  ranges = [],
  dimContext = false,
  colors = new Map(),
}: {
  line: string;
  ranges?: GuideRange[];
  dimContext?: boolean;
  colors?: Map<string, FlowColor>;
}) {
  const palette = useFlowPalette();
  return Array.from(
    line.matchAll(/('[^']*'|"[^"]*"|`[^`]*`|\/\/.*$|#.*$|\b\w+\b|[\s\S])/g),
  ).map((match, index) => {
    const token = match[0];
    const start = match.index;
    const offset = start + token.length;
    const kind =
      token.startsWith('//') || token.startsWith('#')
        ? 'comment'
        : /^['"`]/.test(token)
          ? 'string'
          : keywords.test(token)
            ? 'keyword'
            : /^\d+$/.test(token)
              ? 'number'
              : '';
    const boundaries = [
      start,
      ...ranges
        .flatMap((range) => [range.startColumn - 1, range.endColumn - 1])
        .filter((column) => column > start && column < offset),
      offset,
    ].sort((a, b) => a - b);
    return (
      <span key={index} className={kind ? `token-${kind}` : undefined}>
        {boundaries.slice(0, -1).map((column, part) => {
          const range = ranges.find(
            (range) =>
              column >= range.startColumn - 1 && column < range.endColumn - 1,
          );
          const text = line.slice(column, boundaries[part + 1]);
          return range ? (
            <mark
              key={part}
              className={`guide-symbol guide-role-${range.role} flow-color`}
              style={flowStyleForHue(
                colors.get(referenceKey(range)) ??
                  flowColor({ label: range.symbol, reference: range }, palette),
              )}
              data-symbol={range.symbol}
              data-reference={`${range.line}:${range.startColumn}:${range.endColumn}`}
            >
              {text}
            </mark>
          ) : (
            <span
              key={part}
              className={dimContext ? 'guide-context' : undefined}
            >
              {text}
            </span>
          );
        })}
      </span>
    );
  });
}
