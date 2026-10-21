import { useLayoutEffect, useRef, useState } from 'react';
import type { GuideFlowNode } from '../demoReviewGuide';
import { flowStyle, useFlowPalette } from '../flowColors';

export function CodeSamples({ nodes }: { nodes: GuideFlowNode[] }) {
  const palette = useFlowPalette();
  const layer = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<
    Record<number, { left: number; top: number }>
  >({});
  const rows = new Map<number, GuideFlowNode[]>();
  let reference = nodes[0]?.reference;
  for (const node of nodes) {
    reference = node.reference ?? reference;
    if (!reference || node.sampleValue === undefined) continue;
    const row = rows.get(reference.line) ?? [];
    const label = node.reference?.symbol ?? node.label;
    if (
      !row.some(
        (item) =>
          (item.reference?.symbol ?? item.label) === label &&
          item.sampleValue === node.sampleValue,
      )
    )
      row.push(node);
    rows.set(reference.line, row);
  }

  useLayoutEffect(() => {
    const editor = layer.current?.parentElement;
    if (!editor) return;
    const measure = () => {
      const bounds = editor.getBoundingClientRect();
      const next: typeof positions = {};
      for (const line of editor.querySelectorAll<HTMLElement>('.code-line')) {
        const rect = line.getBoundingClientRect();
        if (
          !rect.height ||
          rect.bottom <= bounds.top ||
          rect.top >= bounds.bottom
        )
          continue;
        const range = document.createRange();
        range.selectNodeContents(line);
        if (line.lastChild?.nodeType === Node.TEXT_NODE)
          range.setEndBefore(line.lastChild);
        const text =
          typeof range.getBoundingClientRect === 'function'
            ? range.getBoundingClientRect()
            : undefined;
        if (!text || text.width === 0) continue;
        next[Number(line.dataset.line)] = {
          left: text.right - bounds.left + 24,
          top: rect.top - bounds.top,
        };
      }
      setPositions((previous) =>
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
  }, [nodes]);

  if (!rows.size) return null;
  return (
    <div
      ref={layer}
      className="code-samples"
      role="group"
      aria-label="Illustrative values"
    >
      {[...rows].map(([line, samples]) => (
        <div
          key={line}
          className="code-sample-row"
          data-sample-line={line}
          data-review-trigger
          onMouseDown={(event) => event.preventDefault()}
          style={{
            ...positions[line],
            maxWidth: positions[line]
              ? `calc(100% - ${positions[line].left}px - 16px)`
              : undefined,
            visibility: positions[line] ? 'visible' : 'hidden',
          }}
        >
          <span className="code-sample-label">example</span>
          {samples.map((node, index) => (
            <span
              key={index}
              className="code-sample flow-color"
              style={flowStyle(node, palette)}
              title={`${node.reference?.symbol ?? node.label} = ${node.sampleValue}`}
            >
              <span>{node.reference?.symbol ?? node.label}</span>
              <span className="code-sample-equals"> = </span>
              <code>{node.sampleValue}</code>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
