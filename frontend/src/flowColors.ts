import { createContext, useContext, type CSSProperties } from 'react';
import type { GuideFlowNode, GuideRange } from './demoReviewGuide';

export type FlowColor = number;
export type FlowPalette = ReadonlyMap<string, FlowColor>;
export const FlowColorContext = createContext<FlowPalette | undefined>(
  undefined,
);
export const useFlowPalette = () => useContext(FlowColorContext);

function identity(node: GuideFlowNode): string {
  // A value's binding identity is independent of the flow that carries it.
  return (
    node.reference?.symbolId ??
    node.reference?.symbol ??
    node.flowKey ??
    node.label
  );
}
function hueForIdentity(key: string): number {
  let hash = 2166136261;
  for (const character of key)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return Math.round((hash / 0xffffffff) * 360000) / 1000;
}
export function flowColor(
  node: GuideFlowNode,
  palette?: FlowPalette,
): FlowColor {
  const key = identity(node);
  return palette?.get(key) ?? hueForIdentity(key);
}

// Assign across the entire review, not just the active step, so colors remain stable
// during navigation. Golden-angle probing separates nearby hashes for arbitrary symbols.
export function createFlowPalette(nodes: GuideFlowNode[]): FlowPalette {
  const keys = [...new Set(nodes.map(identity))].sort();
  const palette = new Map<string, number>();
  const minimumGap = Math.min(48, 240 / Math.max(1, keys.length));
  for (const key of keys) {
    const base = hueForIdentity(key);
    let best = base,
      bestGap = -1;
    for (let attempt = 0; attempt < 72; attempt++) {
      const candidate = (base + attempt * 137.508) % 360;
      const gap = Math.min(
        360,
        ...[...palette.values()].map((hue) => {
          const difference = Math.abs(candidate - hue);
          return Math.min(difference, 360 - difference);
        }),
      );
      if (gap > bestGap) {
        best = candidate;
        bestGap = gap;
      }
      if (gap >= minimumGap) break;
    }
    palette.set(key, Math.round(best * 1000) / 1000);
  }
  return palette;
}
export function flowStyleForHue(hue: FlowColor): CSSProperties {
  return { '--flow-hue': hue } as CSSProperties;
}
export function flowStyle(
  node: GuideFlowNode,
  palette?: FlowPalette,
): CSSProperties {
  return flowStyleForHue(flowColor(node, palette));
}
export function referenceKey(range: GuideRange): string {
  return `${range.line}:${range.startColumn}:${range.endColumn}`;
}
