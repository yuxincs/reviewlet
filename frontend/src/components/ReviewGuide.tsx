import type { GuideStep } from '../demoReviewGuide';
import { Icon } from './Icon';

export function ReviewGuide({
  step,
  isDemo,
  onLine,
  onClose,
}: {
  step: GuideStep;
  isDemo: boolean;
  onLine: (line: number) => void;
  onClose: () => void;
}) {
  return (
    <section className="review-guide">
      <header className="guide-header">
        <div>
          <span className="guide-eyebrow">
            {isDemo ? 'STATIC DEMO' : 'MOCK REVIEW'}
          </span>
          <h2>
            Line {step.lineStart}
            {step.lineEnd !== step.lineStart ? `–${step.lineEnd}` : ''}
          </h2>
        </div>
        <button onClick={onClose} aria-label="Close review guide">
          <Icon name="close" size={17} />
        </button>
      </header>
      <div className="guide-content" key={step.id}>
        <span className={`severity severity-${step.severity}`}>
          {step.severity === 'high'
            ? 'High priority'
            : step.severity === 'medium'
              ? 'Medium priority'
              : 'Suggestion'}
        </span>
        <h3>{step.title}</h3>
        <p>{step.explanation}</p>
        <div className="guide-flow" aria-label="Linked variable references">
          {step.ranges.map((range) => (
            <button
              key={`${range.line}-${range.startColumn}`}
              className={`guide-reference guide-role-${range.role}`}
              onClick={() => onLine(range.line)}
              aria-label={`Show ${range.symbol} on line ${range.line} (${range.role})`}
              title={`Show ${range.symbol} on line ${range.line}`}
            >
              <code>{range.symbol}</code>
              <span>
                L{range.line} · {range.role}
              </span>
            </button>
          ))}
        </div>
        <div className="guide-check">
          <Icon name="code" size={16} />
          <p>{step.check}</p>
        </div>
        <h4>Suggested change</h4>
        <pre className="guide-fix">
          <code>{step.fix}</code>
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
