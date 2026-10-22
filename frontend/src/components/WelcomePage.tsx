import { createFlowPalette, flowStyle } from '../flowColors';
import { Icon } from './Icon';

const exampleValues = [
  { label: 'percentOff', value: '15' },
  { label: 'rate', value: '15' },
  { label: 'discount', value: '112,500¢' },
];
const examplePalette = createFlowPalette(exampleValues);

function PreviewSymbol({ name }: { name: string }) {
  return (
    <code
      className="preview-symbol"
      style={flowStyle({ label: name }, examplePalette)}
    >
      {name}
    </code>
  );
}

export function WelcomePage({
  onCreate,
  onDemo,
}: {
  onCreate: () => void;
  onDemo: () => void;
}) {
  return (
    <section className="welcome-page" aria-labelledby="welcome-heading">
      <div className="welcome-hero">
        <div className="welcome-copy">
          <div className="welcome-eyebrow">
            <span />
            INTELLIGENT CODE REVIEWS
          </div>
          <h1 id="welcome-heading">
            Find the bug.
            <br />
            <span>Understand why.</span>
          </h1>
          <p className="welcome-description">
            Catch issues that hide between the lines. Follow the data,
            understand the impact, and preview a fix, right in your snippet.
          </p>
          <ul className="welcome-features" aria-label="Review features">
            <li>
              <Icon name="clock" size={15} />
              Findings first. Detailed guides follow.
            </li>
            <li>
              <Icon name="sparkle" size={15} />
              Trace variables with sample values.
            </li>
            <li>
              <Icon name="code" size={15} />
              Preview and apply fixes in your code.
            </li>
          </ul>
          <div className="welcome-actions">
            <button className="primary-button welcome-cta" onClick={onCreate}>
              Create a snippet
              <Icon name="arrow" size={17} />
            </button>
            <button className="welcome-demo" onClick={onDemo}>
              <Icon name="code" size={16} />
              Try a demo
            </button>
          </div>
          <div className="welcome-assurance">
            <Icon name="file" size={13} />
            No repository needed. Your snippets stay in your workspace.
          </div>
        </div>
        <div className="welcome-visual">
          <span className="welcome-visual-label">
            FOLLOW THE VALUE. FIND THE CAUSE.
          </span>
          <figure
            className="welcome-preview"
            aria-label="Illustrative review tracing an incorrect percentage discount"
          >
            <div className="preview-titlebar">
              <Icon name="file" size={15} />
              <span>checkout-quote.ts</span>
              <span className="preview-tag">REVIEW PREVIEW</span>
            </div>
            <pre className="preview-code">
              <code>
                <span className="preview-line">
                  <span className="preview-line-number" aria-hidden="true">
                    1
                  </span>
                  <span className="token-keyword">const</span>{' '}
                  <PreviewSymbol name="percentOff" />
                  {' = 15;\n'}
                </span>
                <span className="preview-line">
                  <span className="preview-line-number" aria-hidden="true">
                    2
                  </span>
                  <span className="token-keyword">const</span>
                  {' subtotal = 7500;\n'}
                </span>
                <span className="preview-line preview-line-flagged">
                  <span className="preview-line-number" aria-hidden="true">
                    3
                  </span>
                  <span className="token-keyword">const</span>{' '}
                  <PreviewSymbol name="rate" />
                  {' = '}
                  <PreviewSymbol name="percentOff" />
                  {';\n'}
                </span>
                <span className="preview-line preview-line-flagged">
                  <span className="preview-line-number" aria-hidden="true">
                    4
                  </span>
                  <span className="token-keyword">const</span>{' '}
                  <PreviewSymbol name="discount" />
                  {' = subtotal * '}
                  <PreviewSymbol name="rate" />
                  {';'}
                </span>
              </code>
            </pre>
            <div className="preview-finding">
              <div className="preview-finding-meta">
                <span>
                  <Icon name="info" size={12} />
                  Warning · Bug
                </span>
                <span>Lines 3–4</span>
              </div>
              <h2>A percentage becomes a multiplier.</h2>
              <div
                className="preview-value-flow"
                aria-label="Example values: percentOff 15 flows into rate 15, producing discount 112,500 cents"
              >
                {exampleValues.map((node, index) => (
                  <span
                    className="preview-flow-group"
                    key={node.label}
                    style={flowStyle(node, examplePalette)}
                  >
                    {index > 0 && <Icon name="arrow" size={13} />}
                    <span
                      className="preview-flow-value"
                      style={flowStyle(node, examplePalette)}
                    >
                      <PreviewSymbol name={node.label} />
                      <strong>{node.value}</strong>
                    </span>
                  </span>
                ))}
              </div>
              <ol className="preview-steps">
                <li>
                  <PreviewSymbol name="rate" /> gets 15 instead of 0.15.
                </li>
                <li>
                  <PreviewSymbol name="discount" /> is 100× too large: 112,500¢
                  instead of 1,125¢.
                </li>
              </ol>
              <div className="preview-suggestion">
                <span>PREVIEW FIX</span>
                <code>
                  <span className="token-keyword">const</span>{' '}
                  <PreviewSymbol name="rate" />
                  {' = '}
                  <PreviewSymbol name="percentOff" />
                  {' / 100;'}
                </code>
              </div>
            </div>
            <figcaption>
              <span>
                <Icon name="check" size={12} />
                Illustrative guide
              </span>
              <span>Guides arrive as they’re ready.</span>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
