import { useId, useLayoutEffect, useRef, useState } from 'react';
import {
  flowColor,
  flowStyleForHue,
  useFlowPalette,
  type FlowColor,
} from '../flowColors';
import { routeDataFlows } from '../dataFlowRouting';
import type { GuideFlowNode } from '../demoReviewGuide';

export function DataFlowOverlay({ nodes }: { nodes: GuideFlowNode[] }) {
  const palette = useFlowPalette();
  const layer = useRef<SVGSVGElement>(null);
  const marker = useId().replaceAll(':', '');
  const [paths, setPaths] = useState<{ path: string; color: FlowColor }[]>([]);
  useLayoutEffect(() => {
    const editor = layer.current?.parentElement;
    if (!editor) return;
    const measure = () => {
      const bounds = editor.getBoundingClientRect();
      const positions = nodes.map((node) => {
        const ref = node.reference;
        if (!ref) return undefined;
        const marks = Array.from(
          editor.querySelectorAll<HTMLElement>(
            `mark[data-reference="${ref.line}:${ref.startColumn}:${ref.endColumn}"]`,
          ),
        );
        const rects = marks
          .map((mark) => mark.getBoundingClientRect())
          .filter((rect) => rect.width > 0);
        if (!rects.length) return undefined;
        const left = Math.min(...rects.map((rect) => rect.left)) - bounds.left;
        const right =
          Math.max(...rects.map((rect) => rect.right)) - bounds.left;
        const top = rects[0].top - bounds.top;
        return { left, right, top, bottom: rects[0].bottom - bounds.top };
      });
      const next = routeDataFlows(positions, bounds.width, bounds.height).map(
        (route) => ({
          path: route.path,
          color: flowColor(nodes[route.to], palette),
        }),
      );
      setPaths((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    measure();
    editor.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(measure)
        : undefined;
    observer?.observe(editor);
    return () => {
      editor.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [nodes, palette]);
  return (
    <svg ref={layer} className="data-flow-overlay" aria-hidden="true">
      <defs>
        {[...new Set(nodes.map((node) => flowColor(node, palette)))].map(
          (color) => (
            <marker
              key={color}
              id={`${marker}-${color}`}
              className="flow-color"
              style={flowStyleForHue(color)}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 1 1 L 9 5 L 1 9" />
            </marker>
          ),
        )}
      </defs>
      {paths.map(({ path, color }, index) => (
        <g key={index} className="flow-color" style={flowStyleForHue(color)}>
          <path className="data-flow-track" d={path} />
          <path
            className="data-flow-motion"
            d={path}
            markerEnd={`url(#${marker}-${color})`}
          />
        </g>
      ))}
    </svg>
  );
}
