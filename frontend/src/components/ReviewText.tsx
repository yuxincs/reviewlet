import type { GuideFlowNode } from '../demoReviewGuide';
import { flowStyle, useFlowPalette } from '../flowColors';

// Inline code is rendered as text, with colors resolved from the review's symbols.
export function ReviewText({
  text,
  nodes,
}: {
  text: string;
  nodes: GuideFlowNode[];
}) {
  const palette = useFlowPalette();
  const symbols = [
    ...new Map(
      nodes.flatMap((node) =>
        node.reference?.symbol ? [[node.reference.symbol, node] as const] : [],
      ),
    ).entries(),
  ].sort(([a], [b]) => b.length - a.length);
  const codeParts = (value: string) => {
    const parts = [];
    let plain = '',
      offset = 0;
    while (offset < value.length) {
      const match = symbols.find(
        ([symbol]) =>
          value.startsWith(symbol, offset) &&
          (offset === 0 || !/[\w$.]/.test(value[offset - 1])) &&
          !/[\w$]/.test(value[offset + symbol.length] ?? ''),
      );
      if (!match) {
        plain += value[offset++];
        continue;
      }
      if (plain) {
        parts.push(plain);
        plain = '';
      }
      const [symbol, node] = match;
      parts.push(
        <span
          key={offset}
          className="flow-color"
          style={flowStyle(node, palette)}
        >
          {symbol}
        </span>,
      );
      offset += symbol.length;
    }
    if (plain) parts.push(plain);
    return parts;
  };
  return text.split(/(`[^`\n]+`)/g).map((part, index) =>
    part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
      <code key={index} className="guide-inline-code">
        {codeParts(part.slice(1, -1))}
      </code>
    ) : (
      part
    ),
  );
}
