import { useLayoutEffect, useRef } from 'react';
import type { GuideFinding } from '../demoReviewGuide';
import { Icon } from './Icon';
import { ReviewText } from './ReviewText';

export function ReviewGuide({
  finding,
  activeStep,
  onStep,
  onClose,
  onPreview,
}: {
  finding: GuideFinding;
  activeStep: number;
  onStep: (index: number) => void;
  onClose: () => void;
  onPreview?: () => void;
}) {
  const symbols = finding.steps.flatMap((step) => [
    ...(step.flow?.nodes ?? []),
    ...(step.links?.map((reference) => ({
      label: reference.symbol,
      reference,
    })) ?? []),
  ]);
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
        <h2 className="guide-title" title={finding.summary}>
          <ReviewText text={finding.summary} nodes={symbols} />
        </h2>
        <span
          className="guide-keyboard-hint"
          aria-label="Left and right arrow keys: steps. Up and down arrow keys: bugs."
          title="Left/Right: steps. Up/Down: findings in code order."
        >
          <span className="guide-key-pair" title="Previous / next step">
            <kbd aria-label="Left arrow">
              <Icon
                name="arrow"
                size={12}
                style={{ transform: 'rotate(180deg)' }}
              />
            </kbd>
            <kbd aria-label="Right arrow">
              <Icon name="arrow" size={12} />
            </kbd>
            <span className="guide-key-label">Steps</span>
          </span>
          <span className="guide-key-pair" title="Previous / next bug">
            <kbd aria-label="Up arrow">
              <Icon
                name="arrow"
                size={12}
                style={{ transform: 'rotate(-90deg)' }}
              />
            </kbd>
            <kbd aria-label="Down arrow">
              <Icon
                name="arrow"
                size={12}
                style={{ transform: 'rotate(90deg)' }}
              />
            </kbd>
            <span className="guide-key-label">Bugs</span>
          </span>
        </span>
        <button onClick={onClose} aria-label="Close review guide">
          <Icon name="close" size={17} />
        </button>
      </header>
      <div ref={content} className="guide-content" key={finding.id}>
        <div className="guide-summary">
          <span className={`guide-severity guide-severity-${finding.severity}`}>
            {finding.severity}
          </span>
          <span className="guide-category">{finding.category}</span>
        </div>
        {finding.state === 'needs-recheck' && (
          <p className="guide-recheck-notice" role="status">
            Needs recheck · Code used by this finding changed. Review the
            snippet again before applying its fix.
          </p>
        )}
        <p className="guide-description">
          <ReviewText text={finding.description} nodes={symbols} />
        </p>
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
                <span>
                  <ReviewText
                    text={step.description}
                    nodes={[...symbols, ...(step.flow?.nodes ?? [])]}
                  />
                </span>
              </button>
            </li>
          ))}
        </ol>
        {!onPreview && finding.state !== 'needs-recheck' && (
          <>
            <h3 className="guide-fix-heading">Suggested change</h3>
            <pre className="guide-fix">
              <code>{finding.fix}</code>
            </pre>
          </>
        )}
      </div>
      {onPreview && (
        <footer className="guide-fix-actions">
          <button className="primary-button" onClick={onPreview}>
            <Icon name="code" size={16} />
            Preview fix
          </button>
        </footer>
      )}
    </section>
  );
}
