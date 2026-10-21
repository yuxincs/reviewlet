import { Icon } from './Icon';

export function WelcomePage({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="welcome-page" aria-labelledby="welcome-heading">
      <div className="welcome-hero">
        <div className="welcome-copy">
          <div className="welcome-eyebrow">
            <span />
            AI-POWERED CODE REVIEWS
          </div>
          <h1 id="welcome-heading">
            Small snippets.
            <br />
            <span>Smarter reviews.</span>
          </h1>
          <p className="welcome-description">
            Find hidden issues, understand the why, and explore better fixes
            with intelligent code reviews. Paste a snippet. Start a
            conversation.
          </p>
          <button className="primary-button welcome-cta" onClick={onCreate}>
            Create a snippet
            <Icon name="arrow" size={17} />
          </button>
          <div className="welcome-assurance">
            <Icon name="code" size={13} />
            No repository needed. Just your code.
          </div>
        </div>
        <div className="welcome-visual">
          <span className="welcome-visual-label">FROM CODE TO CLARITY</span>
          <figure
            className="welcome-preview"
            aria-label="Illustrative intelligent code review"
          >
            <div className="preview-titlebar">
              <Icon name="file" size={15} />
              <span>find-user.ts</span>
              <span className="preview-tag">REVIEW PREVIEW</span>
            </div>
            <pre className="preview-code">
              <code>
                <span className="preview-line">
                  <span className="preview-line-number" aria-hidden="true">
                    1
                  </span>
                  <span className="token-keyword">const</span>
                  {' query =\n'}
                </span>
                <span className="preview-line preview-line-flagged">
                  <span className="preview-line-number" aria-hidden="true">
                    2
                  </span>
                  {'  '}
                  <span className="token-string">
                    {'`SELECT * FROM users WHERE id = ${id}`'}
                  </span>
                  {';\n'}
                </span>
                <span className="preview-line">
                  <span className="preview-line-number" aria-hidden="true">
                    3
                  </span>
                  <span className="token-keyword">return</span>
                  {' db.query(query);'}
                </span>
              </code>
            </pre>
            <div className="preview-finding">
              <div className="preview-finding-meta">
                <span>
                  <Icon name="shield" size={12} />
                  Security
                </span>
                <span>Line 2</span>
              </div>
              <h2>User input reaches the SQL query.</h2>
              <p>
                Interpolating input can allow SQL injection. Bind the value as a
                parameter to keep data separate from the query.
              </p>
              <div className="preview-suggestion">
                <span>SUGGESTED FIX</span>
                <code>
                  {"db.query('SELECT * FROM users WHERE id = $1', [id]);"}
                </code>
              </div>
              <div
                className="preview-review-actions"
                aria-label="Example review actions"
              >
                <span>
                  <Icon name="check" size={12} />
                  Accept
                </span>
                <span>
                  <Icon name="close" size={12} />
                  Dismiss
                </span>
                <span>
                  <Icon name="message" size={12} />
                  Discuss
                </span>
              </div>
            </div>
            <figcaption>
              Illustrative review · AI integration coming soon
            </figcaption>
          </figure>
          <div className="welcome-preview-note">
            <Icon name="sparkle" size={15} />
            <span>Understand the why. Decide what comes next.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
