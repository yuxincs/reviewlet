import type { GuideRange } from '../demoReviewGuide';
import type { SyntaxToken } from '../syntax/engine';
import {
  flowColor,
  flowStyleForHue,
  referenceKey,
  useFlowPalette,
  type FlowColor,
} from '../flowColors';

export function CodeHighlight({
  line,
  tokens = [],
  ranges = [],
  dimContext = false,
  colors = new Map(),
}: {
  line: string;
  tokens?: SyntaxToken[];
  ranges?: GuideRange[];
  dimContext?: boolean;
  colors?: Map<string, FlowColor>;
}) {
  const palette = useFlowPalette();
  const boundaries = [
    ...new Set([
      0,
      line.length,
      ...tokens.flatMap((token) => [token.start, token.end]),
      ...ranges.flatMap((range) => [
        range.startColumn - 1,
        range.endColumn - 1,
      ]),
    ]),
  ]
    .filter((column) => column >= 0 && column <= line.length)
    .sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const token = tokens.find(
      (token) => token.start <= start && token.end >= end,
    );
    const range = ranges.find(
      (range) => start >= range.startColumn - 1 && end <= range.endColumn - 1,
    );
    const text = line.slice(start, end);
    return (
      <span key={start} className={token ? `token-${token.kind}` : undefined}>
        {range ? (
          <mark
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
          <span className={dimContext ? 'guide-context' : undefined}>
            {text}
          </span>
        )}
      </span>
    );
  });
}
