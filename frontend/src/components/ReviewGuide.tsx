import { flowStyle, referenceKey, useFlowPalette } from '../flowColors';
import { useLayoutEffect, useRef } from 'react';
import type { GuideFinding } from '../demoReviewGuide';
import { Icon } from './Icon';

export function ReviewGuide({
  finding,
  activeStep,
  isDemo,
  onStep,
  onLine,
  onClose,
}: {
  finding: GuideFinding;
  activeStep: number;
  isDemo: boolean;
  onStep: (index: number) => void;
  onLine: (line: number) => void;
  onClose: () => void;
}) {
  const palette = useFlowPalette();
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = content.current;
    if (!container) return;
    const alignStep = () => {
      const active = container.querySelector<HTMLElement>('.guide-step-active');
      if (!active) {
        container.style.paddingBottom = '';
        container.scrollTop = 0;
        return;
      }
      if (!container.clientHeight) return;
      const inset = parseFloat(getComputedStyle(container).paddingTop) || 0;
      // Leave enough trailing space for even the last step to reach the top.
      container.style.paddingBottom = `${Math.max(inset, container.clientHeight - active.offsetHeight - inset)}px`;
      container.scrollTop = Math.max(
        0,
        active.getBoundingClientRect().top -
          container.getBoundingClientRect().top +
          container.scrollTop -
          inset,
      );
    };
    alignStep();
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(alignStep)
        : undefined;
    observer?.observe(container);
    return () => observer?.disconnect();
  }, [activeStep, finding.id]);
  return (
    <section className="review-guide">
      <header className="guide-header">
        <span className="guide-eyebrow">
          {isDemo ? 'STATIC DEMO' : 'MOCK REVIEW'}
        </span>
        <span
          className="guide-keyboard-hint"
          title="Left/Right: steps. Up/Down: findings in code order."
        >
          ← → steps · ↑ ↓ bugs
        </span>
        <button onClick={onClose} aria-label="Close review guide">
          <Icon name="close" size={17} />
        </button>
      </header>
      <div ref={content} className="guide-content" key={finding.id}>
        <h2
          className="guide-summary"
          aria-label={`${finding.severity} · ${finding.category} · ${finding.summary}`}
        >
          <span className={`guide-severity guide-severity-${finding.severity}`}>
            {finding.severity}
          </span>
          <span className="guide-category">{finding.category}</span>
          <span className="guide-summary-text">{finding.summary}</span>
        </h2>
        <button
          className="guide-overview-button"
          aria-pressed={activeStep === -1}
          onClick={() => onStep(-1)}
        >
          Overview
        </button>
        <ol className="guide-explanation-steps" aria-label="Explanation steps">
          {finding.steps.map((step, index) => (
            <li
              key={index}
              className={activeStep === index ? 'guide-step-active' : ''}
            >
              <button
                className="guide-step-description"
                aria-current={activeStep === index ? 'step' : undefined}
                onClick={() => onStep(index)}
              >
                <span className="guide-step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <span>{step.description}</span>
              </button>
              {step.links && step.links.length > 0 && (
                <div
                  className="guide-flow"
                  aria-label={`Step ${index + 1} symbol links`}
                >
                  {step.links.map((range) => (
                    <button
                      key={`${range.line}-${range.startColumn}`}
                      className={`guide-reference guide-role-${range.role} flow-color`}
                      style={flowStyle(
                        step.flow?.nodes.find(
                          (node) =>
                            node.reference &&
                            referenceKey(node.reference) ===
                              referenceKey(range),
                        ) ?? { label: range.symbol, reference: range },
                        palette,
                      )}
                      onClick={() => {
                        onStep(index);
                        onLine(range.line);
                      }}
                      aria-label={`Show ${range.symbol} on line ${range.line} (${range.role}), step ${index + 1}`}
                      title={`Show ${range.symbol} on line ${range.line}`}
                    >
                      <code>{range.symbol}</code>
                      <span>{range.role}</span>
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
        <h3 className="guide-fix-heading">Suggested change</h3>
        <pre className="guide-fix">
          <code>{finding.fix}</code>
        </pre>
        <p className="guide-footnote">
          {isDemo
            ? 'Prepared for this example. No live AI or automatic data-flow analysis.'
            : 'Local mock findings. No code is sent to an AI service.'}
        </p>
      </div>
    </section>
  );
}
